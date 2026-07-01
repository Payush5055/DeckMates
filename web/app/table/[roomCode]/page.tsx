'use client';

import { TableView } from '@/components/TableView';

export default function TablePage({ params }: { params: { roomCode: string } }) {
  return <TableView code={params.roomCode.toUpperCase()} />;
}
