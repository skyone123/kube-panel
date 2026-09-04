const HIGHLIGHT_RE = /(CrashLoopBackOff|OOMKilled|ImagePullBackOff|ErrImagePull|Error|Warning)/;
const HIGHLIGHT_KEYWORDS = new Set(['CrashLoopBackOff', 'OOMKilled', 'ImagePullBackOff', 'ErrImagePull', 'Error', 'Warning']);

export function HighlightText({ text }: { text: string }) {
  const parts = text.split(HIGHLIGHT_RE);
  return (
    <>
      {parts.map((part, i) =>
        part && HIGHLIGHT_KEYWORDS.has(part)
          ? <mark key={i} className="ctx-highlight">{part}</mark>
          : <span key={i}>{part}</span>
      )}
    </>
  );
}
