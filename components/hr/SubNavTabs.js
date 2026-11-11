'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function SubNavTabs({ items = [] }) {
  const pathname = usePathname();

  return (
    <div className="hr-segmented-wrap">
      <div className="hr-segmented-control" role="tablist">
        {items.map((it) => {
          const active = pathname === it.href;
          return (
            <Link
              key={it.href}
              href={it.href}
              role="tab"
              aria-selected={active}
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
