'use client';

import { Crazy8TableView } from '@/components/Crazy8TableView';

export default function Crazy8TablePage({ params }: { params: { roomCode: string } }) {
  return <Crazy8TableView code={params.roomCode.toUpperCase()} />;
}
