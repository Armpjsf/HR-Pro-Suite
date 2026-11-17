'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function SubNavTabs({ items = [] }) {
  const pathname = usePathname();

  return (
    <div className="hr-segmented-wrap">
      <div className="hr-segmented-control" role="navigation" aria-label="เมนูย่อย">
        {items.map((it) => {
          const active = pathname === it.href;
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? 'page' : undefined}
              className={`hr-segmented-item${active ? ' active' : ''}`}
            >
              <span className="hr-segmented-icon">{it.icon}</span>
              <span>{it.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
