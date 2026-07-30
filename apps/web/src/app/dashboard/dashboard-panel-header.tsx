export function PanelHeader({
  kicker,
  title,
  titleId,
}: Readonly<{ kicker: string; title: string; titleId?: string }>) {
  return (
    <header className="w-full max-w-app-content space-y-4 overflow-x-auto text-left">
      <p className="font-mono text-label uppercase tracking-[0.1em] text-overline">{kicker}</p>
      <h2
        id={titleId}
        className="w-max max-w-none whitespace-nowrap font-display text-display-md text-display"
      >
        {title}
      </h2>
    </header>
  );
}
