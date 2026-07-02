// Иконка Facebook «f». lucide-react больше не экспортирует бренд-иконки, поэтому инлайн-SVG.
// currentColor — цвет задаётся классом на элементе (напр. text-[#1877f2]).
export function FacebookIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M24 12.073C24 5.404 18.627 0 12 0S0 5.404 0 12.073c0 6.026 4.388 11.02 10.125 11.927v-8.437H7.078v-3.49h3.047V9.412c0-3.017 1.792-4.684 4.533-4.684 1.313 0 2.686.235 2.686.235v2.97h-1.513c-1.49 0-1.955.93-1.955 1.886v2.264h3.328l-.532 3.49h-2.796v8.437C19.612 23.094 24 18.1 24 12.073z" />
    </svg>
  );
}
