/** Full-screen dimmed backdrop for result panels (round-complete, match-end). */
export function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-rim/85 p-4 backdrop-blur-sm">
      {children}
    </div>
  );
}
