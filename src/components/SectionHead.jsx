/** Eyebrow + heading + intro text, used at the top of most sections. */
export default function SectionHead({ eyebrow, title, text, row = false, center = false, children }) {
  const cls = ['section-head', row && 'section-head--row', center && 'section-head--center'].filter(Boolean).join(' ');
  const copy = (
    <>
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h2>{title}</h2>
      {text && <p>{text}</p>}
    </>
  );
  return (
    <div className={cls} data-reveal>
      {row ? <div>{copy}</div> : copy}
      {children}
    </div>
  );
}
