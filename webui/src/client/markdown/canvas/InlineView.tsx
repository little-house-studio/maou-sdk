import type { InlineMark } from "../parser";

export function InlineView({ marks }: { marks: InlineMark[] }) {
  return (
    <>
      {marks.map((m, i) => {
        const key = `${m.type}-${i}`;
        switch (m.type) {
          case "text":
            return <span key={key}>{m.text}</span>;
          case "code":
            return (
              <code key={key} className="mdc-inline-code">
                {m.text}
              </code>
            );
          case "strong":
            return (
              <strong key={key}>
                <InlineView marks={m.children} />
              </strong>
            );
          case "em":
            return (
              <em key={key}>
                <InlineView marks={m.children} />
              </em>
            );
          case "del":
            return (
              <del key={key}>
                <InlineView marks={m.children} />
              </del>
            );
          case "link":
            return (
              <a
                key={key}
                className="mdc-link"
                href={m.href}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <InlineView marks={m.children} />
              </a>
            );
          default:
            return null;
        }
      })}
    </>
  );
}
