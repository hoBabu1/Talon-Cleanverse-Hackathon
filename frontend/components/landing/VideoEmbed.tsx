"use client";

import Image from "next/image";
import { useState } from "react";
import { Play } from "lucide-react";
import { DEMO_VIDEO_ID } from "@/lib/site";

type VideoEmbedProps = {
  /** YouTube video ID. Defaults to the site-wide DEMO_VIDEO_ID constant —
   *  paste the real ID in lib/site.ts once the demo is recorded. */
  videoId?: string;
  title?: string;
};

/**
 * 16:9 demo video in a bordered card.
 * - No videoId yet → branded placeholder panel (no broken embed).
 * - With videoId → click-to-play facade (no YouTube JS until requested).
 */
export default function VideoEmbed({
  videoId = DEMO_VIDEO_ID,
  title = "Talon demo — eligibility drift, handled end to end",
}: VideoEmbedProps) {
  const [playing, setPlaying] = useState(false);
  const [thumbOk, setThumbOk] = useState(true);

  return (
    <div className="relative overflow-hidden rounded-card border border-edge bg-card shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
      <div className="relative aspect-video w-full">
        {videoId && playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        ) : videoId ? (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label="Play the Talon demo video"
            className="group absolute inset-0 h-full w-full"
          >
            {thumbOk ? (
              // eslint-disable-next-line @next/next/no-img-element -- external YouTube thumbnail, dynamic ID
              <img
                src={`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`}
                alt=""
                onError={() => setThumbOk(false)}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : null}
            <span className="absolute inset-0 bg-black/45 transition-colors duration-300 group-hover:bg-black/30" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-white shadow-[0_12px_40px_rgba(248,101,28,0.45)] transition-transform duration-300 group-hover:scale-110 md:h-20 md:w-20">
                <Play size={26} fill="currentColor" className="ml-1" />
              </span>
            </span>
          </button>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[radial-gradient(ellipse_at_center,rgba(248,101,28,0.07),transparent_65%)] px-6 text-center">
            <Image
              src="/brand/talon-mark.png"
              alt=""
              width={56}
              height={56}
              className="rounded-2xl opacity-90"
            />
            <span className="flex h-14 w-14 items-center justify-center rounded-full border border-accent/40 bg-accent/10 text-accent">
              <Play size={22} fill="currentColor" className="ml-0.5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-white md:text-base">
                Demo video
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted md:text-sm">
                Recorded during the 48-hour build window — drops with the final
                submission.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
