import { forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  // Gold CTA — "Play now", "Create table".
  primary: 'bg-gold text-rim hover:brightness-110 disabled:opacity-40',
  // Wine, used sparingly.
  secondary: 'bg-wine text-ink hover:brightness-110 disabled:opacity-40',
  // Outlined, low-emphasis.
  ghost: 'bg-transparent text-ink ring-1 ring-ink/25 hover:ring-gold/60 disabled:opacity-40',
};

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', className = '', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center rounded-xl px-5 py-3 font-medium tracking-wide transition disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
});
