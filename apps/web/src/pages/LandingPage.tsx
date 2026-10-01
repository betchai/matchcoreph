import { useEffect, useState } from 'react';

function splitLanding(html: string): { css: string; body: string } {
  const css = /<style>([^]*?)<\/style>/.exec(html)?.[1] ?? '';
  const body = /<body[^>]*>([^]*?)<\/body>/.exec(html)?.[1] ?? '';
  return { css, body };
}

export default function LandingPage() {
  const [markup, setMarkup] = useState<{ css: string; body: string } | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/landing', { headers: { accept: 'text/html' } })
      .then((r) => (r.ok ? r.text() : null))
      .then((html) => {
        if (active && html) setMarkup(splitLanding(html));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!markup) return <div className="min-h-screen bg-[#242526]" />;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: markup.css }} />
      <div dangerouslySetInnerHTML={{ __html: markup.body }} />
    </>
  );
}