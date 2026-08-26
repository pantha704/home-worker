import Link from "next/link";

import { InkMarkIcon } from "@/components/icons";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link aria-label="Homeworker home" className="brand" href="/">
      <span className="brand-mark"><InkMarkIcon size={compact ? 19 : 22} /></span>
      <span className="brand-name"><strong>Homeworker</strong></span>
    </Link>
  );
}
