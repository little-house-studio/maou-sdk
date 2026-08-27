import React from "react";
import { OptionalOutlet } from "./OptionalOutlet";
import { ComposerBar } from "./ComposerBar";
import { QueueDock } from "./QueueDock";
import type { ComposerProps } from "./types";

/** Independent composer stack — queue + bar + footer. */
export function Composer(props: ComposerProps) {
  return (
    <div
      className="codex-composer-dock wire-composer-dock composer-seat composer-stack"
      data-composer=""
      data-variant={props.variant}
    >
      <OptionalOutlet
        name="composer.queue"
        props={props}
        fallback={<QueueDock {...props} />}
      />
      <OptionalOutlet
        name="composer.bar"
        props={props}
        fallback={<ComposerBar {...props} />}
      />
      <OptionalOutlet
        name="composer.footer"
        props={props}
        fallback={null}
      />
    </div>
  );
}
