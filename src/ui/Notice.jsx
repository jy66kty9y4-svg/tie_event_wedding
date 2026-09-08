export function Notice({ notice, onDismiss }) {
  if (!notice) return null;
  return <div className={`notice ${notice.kind || ''}`} role="status"><span>{notice.text}</span><button onClick={onDismiss} aria-label="Закрыть">×</button></div>;
}
