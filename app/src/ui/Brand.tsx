export function BrandMark() {
  // a citation bracket enclosing a check: the product in one glyph
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3H4v18h3" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 3h3v18h-3" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.2 12.4l2.6 2.6 5-5.6" fill="none" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <BrandMark />
      Veracite
    </div>
  );
}
