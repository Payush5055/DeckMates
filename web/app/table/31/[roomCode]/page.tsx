'use client';

import { ThirtyOneTableView } from '@/components/ThirtyOneTableView';

export default function ThirtyOneTablePage({ params }: { params: { roomCode: string } }) {
  return <ThirtyOneTableView code={params.roomCode.toUpperCase()} />;
}
