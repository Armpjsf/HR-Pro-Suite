'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LegacyAdminUsersRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/hr/users');
  }, [router]);

  return null;
}
