// The outline dog's head the app uses for "dogs welcome" (#290, #293): a
// floppy-eared face in the current text color. Shown only when dogs are
// welcome, never as a "no dogs" mark. Decorative: whatever shows it names it.
export function DogIcon({ size = 20, strokeWidth = 1.7 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8.2 6.3C9.2 5.2 10.5 4.6 12 4.6s2.8.6 3.8 1.7" />
      <path d="M8.2 6.3C6.6 5.4 4.4 5.9 3.8 8.2c-.6 2.4.4 5 2.3 5.6.6.2 1.1-.1 1.2-.6" />
      <path d="M15.8 6.3c1.6-.9 3.8-.4 4.4 1.9.6 2.4-.4 5-2.3 5.6-.6.2-1.1-.1-1.2-.6" />
      <path d="M7.3 9.2v4.6c0 3.3 2.1 5.6 4.7 5.6s4.7-2.3 4.7-5.6V9.2" />
      <circle cx="10" cy="11.2" r=".9" fill="currentColor" stroke="none" />
      <circle cx="14" cy="11.2" r=".9" fill="currentColor" stroke="none" />
      <path d="M10.9 14.4h2.2l-1.1 1.2z" fill="currentColor" />
      <path d="M12 15.6v1.1M10.6 17.1c.8.6 2 .6 2.8 0" />
    </svg>
  );
}
