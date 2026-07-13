'use client';

import { TeenPattiTableView } from '@/components/TeenPattiTableView';

export default function TeenPattiTablePage({ params }: { params: { roomCode: string } }) {
  return <TeenPattiTableView code={params.roomCode.toUpperCase()} />;
}
