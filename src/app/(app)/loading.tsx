// Shown at once while a screen loads, so a tap on a slow phone visibly does something.
export default function Loading() {
  return (
    <section aria-busy="true">
      <p className="loading-note" role="status">
        טוענים…
      </p>
    </section>
  );
}
