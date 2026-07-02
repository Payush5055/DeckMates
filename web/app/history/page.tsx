'use client';

/** /history moved into /account — keep the old URL working via redirect. */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HistoryRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/account');
  }, [router]);
  return null;
}
