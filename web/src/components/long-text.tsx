export function LongText({ text }: { text: string }) {
  if (text.length <= 180) return <p className="long-text">{text}</p>;
  return (
    <details className="long-text-disclosure">
      <summary>
        <span className="long-text-preview">{text}</span>
        <span className="long-text-toggle">
          <span>展开全文</span>
          <span>收起全文</span>
        </span>
      </summary>
    </details>
  );
}
