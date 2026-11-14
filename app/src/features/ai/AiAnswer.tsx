import type { Block, Inline } from "./format.ts";

function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.bold ? (
          <strong key={index}>{part.text}</strong>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** Model output, rendered strictly as text nodes. */
export default function AiAnswer({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, index) =>
        block.kind === "p" ? (
          <p key={index} dir="auto">
            <Inlines parts={block.inlines} />
          </p>
        ) : block.kind === "ul" ? (
          <ul key={index}>
            {block.items.map((item, i) => (
              <li key={i} dir="auto">
                <Inlines parts={item} />
              </li>
            ))}
          </ul>
        ) : (
          <ol key={index} start={block.start === 1 ? undefined : block.start}>
            {block.items.map((item, i) => (
              <li key={i} dir="auto">
                <Inlines parts={item} />
              </li>
            ))}
          </ol>
        ),
      )}
    </>
  );
}
