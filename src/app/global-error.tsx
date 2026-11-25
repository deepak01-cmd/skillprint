"use client";
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en"><body style={{ fontFamily: "system-ui, sans-serif", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "#f5f6fb", color: "#111427" }}>
      <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>Something went wrong</h1>
        <p style={{ color: "#747a96" }}>Your data is safe. Reload to continue.</p>
        <button onClick={reset} style={{ marginTop: 12, padding: "10px 18px", borderRadius: 12, border: 0, background: "#635bff", color: "#fff", fontWeight: 600, cursor: "pointer" }}>Reload</button>
      </div>
    </body></html>
  );
}
