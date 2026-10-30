'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function SubNavTabs({ items = [] }) {
  const pathname = usePathname();

  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto', paddingBottom: 4 }}>
      {items.map((it) => {
        const active = pathname === it.href;
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`hr-btn ${active ? 'hr-btn-primary' : ''}`}
            style={{
              padding: '6px 16px',
              fontSize: 13,
              fontWeight: active ? 700 : 500,
              background: active ? undefined : '#f8fafc',
              border: active ? undefined : '1px solid #e2e8f0',
              color: active ? '#fff' : '#475569',
              whiteSpace: 'nowrap',
              textDecoration: 'none',
              borderRadius: 8,
              boxShadow: active ? '0 2px 4px rgba(109,94,245,0.2)' : 'none',
            }}
          >
            <span>{it.icon}</span> {it.label}
          </Link>
        );
      })}
    </div>
  );
}
