-- Talon — Supabase schema
--
-- THIS IS A READ-OPTIMIZED MIRROR OF ON-CHAIN STATE, NEVER THE SOURCE OF TRUTH.
-- The chain (A-Token balances, EscrowVault ledger) and the Cleanverse API (A-Pass
-- state) are always authoritative. If this database and the chain disagree, the
-- chain wins and the indexer re-syncs. Nothing here is ever used to decide whether
-- someone gets paid.
--
-- Two conventions enforced throughout, both of which exist to prevent a specific
-- class of silent bug:
--
--   1. ADDRESSES ARE STORED LOWERCASE. viem returns checksummed addresses, ethers
--      and raw RPC logs return lowercase. Mixing them produces two rows for one
--      holder and a cap table that double-counts. CHECK constraints reject any
--      address that isn't lowercase hex, so the bug fails loudly at write time.
--
--   2. AMOUNTS ARE RAW INTEGER UNITS (numeric(78,0)), never decimals. aUSDC has 6
--      decimals; a float somewhere in this pipeline renders "1000000 aUSDC" or
--      silently loses precision. Formatting happens in the UI, once, at the edge.

-- ---------------------------------------------------------------------------
-- Indexer bookkeeping
-- ---------------------------------------------------------------------------

-- eth_getLogs is capped at 100 blocks on Monad (confirmed live: a 1000-block
-- request returns -32614 "eth_getLogs is limited to a 100 range"). The indexer
-- pages in 99-block steps and persists progress here so a restart resumes rather
-- than re-scanning from the deploy block or, worse, skipping the gap.
create table if not exists indexer_cursor (
  name              text primary key,          -- e.g. 'vault', 'cam', 'tlnb'
  last_block        bigint not null,
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Cap table
-- ---------------------------------------------------------------------------

-- Enumerates the holder SET from TLNB Transfer logs. Balances are NOT reconstructed
-- from these events -- archive state works on Monad's public RPC (confirmed live at
-- head-100,000), so balances come from balanceOf at the record block via multicall.
-- Enumeration tolerates a missed log (a holder simply doesn't appear); event-sourced
-- balance reconstruction does not (one missed log makes every later balance wrong).
create table if not exists asset_transfers (
  tx_hash           text not null,
  log_index         int  not null,
  block_number      bigint not null,
  asset             text not null check (asset = lower(asset)),
  from_address      text not null check (from_address = lower(from_address)),
  to_address        text not null check (to_address = lower(to_address)),
  amount            numeric(78,0) not null,
  indexed_at        timestamptz not null default now(),
  primary key (tx_hash, log_index)             -- restart-idempotent re-indexing
);

create index if not exists idx_asset_transfers_to    on asset_transfers (asset, to_address);
create index if not exists idx_asset_transfers_from  on asset_transfers (asset, from_address);
create index if not exists idx_asset_transfers_block on asset_transfers (block_number);

-- Live A-Pass state per wallet, refreshed by the 30s poller.
--
-- FIVE display states, not four. query_apass returns {"code":"0002","data":""} --
-- an EMPTY STRING, not null and not an object -- for a wallet with no A-Pass
-- (confirmed live). Reading data.status off that yields undefined, every boolean
-- check reads false, and the holder renders as ACTIVE. has_apass makes that case
-- explicit and unmissable.
--
-- is_frozen and is_expired are SEPARATE booleans because BOTH can be true at once.
-- Collapsing them into one status column is the same mistake the contracts
-- deliberately avoid on-chain.
create table if not exists holders (
  wallet_address    text primary key check (wallet_address = lower(wallet_address)),
  chain             text not null default 'monad-testnet',

  has_apass         boolean not null default false,
  is_frozen         boolean not null default false,
  is_expired        boolean not null default false,
  apass_status      smallint,                  -- raw Cleanverse status, mirrored verbatim
  expiration_time   bigint,                    -- unix seconds, verbatim

  -- verify_apass answers "will a transfer actually work?" and accounts for the
  -- token's compliance RULES, which query_apass does not. Both are polled because
  -- they answer genuinely different questions: can-it-work vs why-not.
  verify_code       smallint,                  -- 1 no token, 2 no A-Pass, 3 expired/frozen, 4 OK
  verify_checked_at timestamptz,

  cv_record_id      text,
  customer_id       text,

  -- Staleness is a first-class UI state: >90s stale renders "Cleanverse
  -- unreachable -- last known state as of HH:MM:SS". Stale-and-labelled beats
  -- fresh-looking-and-wrong.
  last_synced_at    timestamptz not null default now(),
  sync_error        text
);

create index if not exists idx_holders_synced on holders (last_synced_at);

-- ---------------------------------------------------------------------------
-- Corporate actions
-- ---------------------------------------------------------------------------

-- Full mirror of the on-chain CorporateAction struct. running_hash and
-- holder_set_hash are mirrored so the UI can display commitment parity without a
-- chain round-trip -- but getAction() is still what gates execution.
create table if not exists corporate_actions (
  action_id         bigint primary key,        -- on-chain id; predicted via actionsCount(), verified against the ActionDeclared receipt
  payment_token     text not null check (payment_token = lower(payment_token)),  -- what holders are PAID in
  asset             text not null check (asset = lower(asset)),                  -- what the action is ABOUT
  record_block      bigint not null,
  total_amount      numeric(78,0) not null,
  holder_set_hash   text not null,
  running_hash      text,
  next_index        int not null default 0,
  total_holders     int not null,
  paid_count        int not null default 0,
  escrowed_count    int not null default 0,
  coverage_complete boolean,

  -- 'Prepared' is PLANNED-BUT-NOT-ON-CHAIN, and it is a load-bearing distinction rather
  -- than a cosmetic one. /actions/prepare persists a plan before any declaring tx exists;
  -- ONLY the indexer, on a real ActionDeclared event, promotes a row past this status.
  --
  -- Collapsing the two states bricked prepare once already: it wrote 'Declared'
  -- optimistically, no declare tx followed, and the actionId-clash gate then read that row
  -- forever as proof the id was taken. actionsCount() never advanced, so every retry
  -- predicted the same id and got the same 409 -- permanently, despite the 409 advising a
  -- retry. A planned action and a declared one are different facts and are stored as such.
  status            text not null default 'Prepared'
                      check (status in ('Prepared','Declared','Executing','Closed')),

  declare_tx_hash   text,
  declared_at       timestamptz not null default now(),
  closed_at         timestamptz,

  -- The invariant that makes the poison row unrepresentable rather than merely fixed:
  -- a row is 'Prepared' exactly when no declaring transaction exists for it. An on-chain
  -- status with no tx hash IS the poison shape, and it is now rejected at write time.
  constraint corporate_actions_declared_has_tx
    check ((status = 'Prepared') = (declare_tx_hash is null))
);

-- The record-date snapshot, persisted at PREPARE time. This cannot be re-derived
-- later if the indexer resets, and it is the evidence behind every entitlement.
-- Excluded holders are kept as rows (not dropped) so the UI can honestly show
-- "N holders excluded: entitlement rounds to zero" -- real transfer-agent
-- behaviour, and worth displaying rather than hiding.
create table if not exists record_date_snapshots (
  action_id         bigint not null references corporate_actions(action_id) on delete cascade,
  holder            text not null check (holder = lower(holder)),
  asset_balance     numeric(78,0) not null,    -- balanceOf(holder) at record_block
  entitlement       numeric(78,0) not null,    -- raw payment-token units, floor-rounded
  included          boolean not null,
  exclusion_reason  text check (exclusion_reason in
                      ('rounds_to_zero','zero_address','vault','manager','token_self')),
  batch_index       int,                       -- null when excluded
  position_in_batch int,                       -- intra-batch order: the hash depends on it
  primary key (action_id, holder)
);

create index if not exists idx_snapshot_batch on record_date_snapshots (action_id, batch_index, position_in_batch);

-- The FROZEN batch plan. The chained hash depends on batch BOUNDARIES and
-- INTRA-BATCH ORDER, so calldata is served from this stored plan and never
-- recomputed -- recomputation risks a different split, and the mismatch stays
-- invisible until closeAction, after money has already moved.
create table if not exists action_batches (
  action_id         bigint not null references corporate_actions(action_id) on delete cascade,
  batch_index       int not null,
  holders           text[] not null,
  amounts           numeric(78,0)[] not null,
  batch_total       numeric(78,0) not null,
  expected_hash     text,                      -- runningHash after this batch
  tx_hash           text,
  executed_at       timestamptz,
  primary key (action_id, batch_index)
);

-- ---------------------------------------------------------------------------
-- Payout events (CorporateActionManager)
-- ---------------------------------------------------------------------------

-- Reason selectors are the real bytes4 values read from the deployed contract:
--   0x322fde89  REASON_FROZEN          bytes4(keccak256("APassNotActive(address)"))
--   0xaecc0dbe  REASON_EXPIRED         bytes4(keccak256("APassExpired(address)"))
--   0x4731ab32  REASON_RETURNED_FALSE
--   0x19957115  REASON_UNKNOWN_REVERT
--
-- FROZEN and EXPIRED are deliberately distinct. Folding them into one "compliance"
-- bucket would falsify this project's own headline claim -- that it does not
-- conflate lapsed-with-sanctioned -- using its own audit trail. The CHECK
-- constraint makes that mistake impossible to make accidentally.
create table if not exists payout_events (
  tx_hash           text not null,
  log_index         int  not null,
  block_number      bigint not null,
  action_id         bigint not null,
  holder            text not null check (holder = lower(holder)),
  amount            numeric(78,0) not null,
  outcome           text not null check (outcome in ('paid','escrowed')),

  reason_selector   text check (reason_selector in
                      ('0x322fde89','0xaecc0dbe','0x4731ab32','0x19957115')),
  offender          text check (offender is null or offender = lower(offender)),
  raw_revert        text,                      -- hex; surfaced verbatim for UNKNOWN_REVERT rows

  indexed_at        timestamptz not null default now(),
  primary key (tx_hash, log_index),

  -- A paid leg has no reason; an escrowed leg must have one.
  constraint reason_matches_outcome check (
    (outcome = 'paid'     and reason_selector is null) or
    (outcome = 'escrowed' and reason_selector is not null)
  )
);

create index if not exists idx_payout_action on payout_events (action_id);
create index if not exists idx_payout_holder on payout_events (holder);

-- ---------------------------------------------------------------------------
-- Escrow (EscrowVault) -- historical log only
-- ---------------------------------------------------------------------------

-- NOT a live balance mirror. Current balances are read from the chain
-- (ledgerOf / beneficiariesOf) via multicall. These tables exist only for the
-- historical deposit/release record, which the chain views genuinely cannot
-- reproduce because entries are removed on release.
--
-- Per-deposit rows keyed (tx_hash, log_index). The previous schema's
-- unique(beneficiary, token) with a single reason column collapsed a holder
-- escrowed FROZEN by one action and EXPIRED by another into one row, destroying
-- the headline differentiator inside our own database.
create table if not exists escrow_deposits (
  tx_hash           text not null,
  log_index         int  not null,
  block_number      bigint not null,
  beneficiary       text not null check (beneficiary = lower(beneficiary)),
  token             text not null check (token = lower(token)),
  amount            numeric(78,0) not null,
  action_id         bigint not null,
  reason_selector   text not null check (reason_selector in
                      ('0x322fde89','0xaecc0dbe','0x4731ab32','0x19957115')),
  offender          text check (offender is null or offender = lower(offender)),
  indexed_at        timestamptz not null default now(),
  primary key (tx_hash, log_index)
);

create index if not exists idx_escrow_dep_beneficiary on escrow_deposits (beneficiary, token);
create index if not exists idx_escrow_dep_action      on escrow_deposits (action_id);

-- Released carries NO actionId (only Deposited does), so attributing a release to
-- an action is a FIFO INFERENCE, not a fact. inferred_action_id is nullable and
-- attribution_certain records whether the beneficiary had escrow from exactly one
-- action -- in which case the attribution is genuinely certain. The UI must label
-- inferred rows as inferred. Presenting an inference as a fact is precisely the
-- integrity failure this whole project argues against.
create table if not exists escrow_releases (
  tx_hash             text not null,
  log_index           int  not null,
  block_number        bigint not null,
  beneficiary         text not null check (beneficiary = lower(beneficiary)),
  token               text not null check (token = lower(token)),
  amount              numeric(78,0) not null,
  trigger_address     text not null check (trigger_address = lower(trigger_address)),
  inferred_action_id  bigint,
  attribution_certain boolean not null default false,
  indexed_at          timestamptz not null default now(),
  primary key (tx_hash, log_index)
);

create index if not exists idx_escrow_rel_beneficiary on escrow_releases (beneficiary, token);

-- ---------------------------------------------------------------------------
-- Cleanverse Transaction Reports (audit pack)
-- ---------------------------------------------------------------------------

-- Called a "Transaction Report", not a "Travel Rule Report": per the Cleanverse
-- docs, Travel Rule reports cover withdrawals, while A-Token transfers yield
-- Transaction Reports.
--
-- download_travel_rule does NOT verify that the wallet participated in the
-- transaction -- confirmed live, it returned a valid report for an address that
-- was never in the tx. So participation_verified records that the wallet actually
-- appears in a confirmed Transfer log of that tx, and a report is only ever
-- requested when that holds. Attaching an official-looking PDF to a payment that
-- never happened is the same integrity failure the contracts prevent, one layer up.
--
-- URL expiry is undocumented, so the bytes are fetched and stored at index time
-- rather than persisting a link that may rot before judging.
create table if not exists cleanverse_reports (
  tx_hash               text not null,
  wallet                text not null check (wallet = lower(wallet)),
  participation_verified boolean not null default false,
  report_url            text,
  report_bytes          bytea,
  content_type          text,
  file_name             text,                  -- API returns null; real name is in Content-Disposition
  fetched_at            timestamptz not null default now(),
  fetch_error           text,
  primary key (tx_hash, wallet)
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

-- RLS is enabled with NO policies, deliberately. With RLS on and no policy
-- defined, Postgres denies all access to the anon and authenticated roles --
-- which is exactly the intent here. The backend connects with the service_role
-- key, which bypasses RLS entirely, and the browser never queries Supabase
-- directly: it goes through the backend API.
--
-- Verified empirically rather than assumed: with the anon key, a read returns
-- [] (all rows filtered, nothing leaked) and a write is rejected with
-- 42501 "new row violates row-level security policy".
--
-- This is more than hygiene. These tables mirror the escrow audit trail, and a
-- world-writable audit mirror would undercut the premise of the whole project.

alter table public.indexer_cursor        enable row level security;
alter table public.asset_transfers       enable row level security;
alter table public.holders               enable row level security;
alter table public.corporate_actions     enable row level security;
alter table public.record_date_snapshots enable row level security;
alter table public.action_batches        enable row level security;
alter table public.payout_events         enable row level security;
alter table public.escrow_deposits       enable row level security;
alter table public.escrow_releases       enable row level security;
alter table public.cleanverse_reports    enable row level security;
