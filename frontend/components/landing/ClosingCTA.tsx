import { ArrowRight, ArrowUpRight } from "lucide-react";
import { APP_ENTRY, GITHUB_URL } from "@/lib/site";
import Button from "./Button";
import Reveal from "./Reveal";

export default function ClosingCTA() {
  return (
    <section className="border-t border-white/5">
      <div className="mx-auto w-full max-w-6xl px-5 py-20 md:px-8 md:py-28">
        <Reveal>
          <div className="relative overflow-hidden rounded-[28px] border border-edge bg-card px-6 py-16 text-center md:py-24">
            <div
              aria-hidden
              className="pointer-events-none absolute -top-32 left-1/2 h-[380px] w-[720px] -translate-x-1/2 rounded-full bg-accent/[0.09] blur-[110px]"
            />
            <div className="relative">
              <h2 className="mx-auto max-w-2xl text-3xl font-extrabold tracking-tight text-white md:text-[40px] md:leading-[1.15]">
                Watch a frozen holder get paid —{" "}
                <span className="text-accent">legally.</span>
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-muted md:text-base">
                The demo runs the full drift-and-recovery loop on real
                contracts: a holder gets frozen mid-distribution, doesn&rsquo;t
                panic, keeps their entitlement safe in escrow, and claims it the
                second they re-verify — with a receipt so airtight the auditors
                get bored. No coupons were harmed in the making of this demo.
              </p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button href={APP_ENTRY} size="lg" className="w-full sm:w-auto">
                  Launch App
                  <ArrowRight size={17} strokeWidth={2.5} />
                </Button>
                <Button
                  href={GITHUB_URL}
                  variant="ghost"
                  size="lg"
                  external
                  className="w-full sm:w-auto"
                >
                  View on GitHub
                  <ArrowUpRight size={16} strokeWidth={2.5} />
                </Button>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
