import { lineRead, lineWrite } from '@/server/line-route';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const GET = lineRead;
export const POST = lineWrite;
