# GitHub และ Vercel deployment แรก

6 พฤศจิกายน 2026 · เจ้าของอนุญาตนำโค้ดขึ้น GitHub และ Vercel แล้ว **หน้าเว็บออนไลน์ แต่ backend ยังไม่ตั้งค่า** Google Apps Script ยังเป็นระบบใช้งานจริง

หน้านี้เป็นหลักฐาน deployment แรกของ main ณ วันที่ข้างต้น ปัจจุบัน staging เชื่อม backend และ Login จริงได้แล้วตาม [สถานะ staging](vercel-staging.md) ส่วน main ยังไม่เปิด backend production และ Apps Script ยังเป็นระบบใช้งานจริง

## ทรัพยากรและหลักฐาน

| รายการ | ค่าที่ตรวจแล้ว |
|---|---|
| GitHub | [Burinboo256/Happy_Victory_Task_Center](https://github.com/Burinboo256/Happy_Victory_Task_Center) · public · branch `main` |
| Initial commit | [`ec44e92`](https://github.com/Burinboo256/Happy_Victory_Task_Center/commit/ec44e92debdd0ff52b00fe71bccd6ebbfc9128da) |
| CI | [run 42172256512](https://github.com/Burinboo256/Happy_Victory_Task_Center/actions/runs/42172256512) ผ่าน lint / typecheck / audit / build, web tests 85, Apps Script 61 และ load rehearsal |
| Vercel team / project | `burin` / `happy-victory-task-center` |
| Project ID | `prj_9CGQJT2lN7pCPAywROVHRnr7y8VX` |
| Build settings | Next.js, root `web`, install `npm ci`, build `npm run build`, Node `24.x` |
| URL | [happy-victory-task-center.vercel.app](https://happy-victory-task-center.vercel.app) |
| ส่งงานใหม่ | [เปิดฟอร์มสำหรับมือถือ](https://happy-victory-task-center.vercel.app/tasks/new?openExternalBrowser=1) · ยังรอตั้ง backend |
| Deployment | `dpl_9UDscUBUgZ4TsB9yZuz4qS9i3mPq` · READY · source initial commit |

Vercel API รับคำขอ `target=staging` แล้ว deployment จริงระบุ `target=production` และผูก project domains จึงบันทึกตามสถานะจริง ไม่ถือว่ามี environment staging ที่ตั้งค่าเสร็จแล้ว ต้องใช้ `APP_ENV` / DB binding ให้ตรง hosting target ก่อนเปิด Login ตาม config guard เดิม

## ผลตรวจจากภายนอก

- `/login` ตอบ 200 และแสดง “กำลังเตรียมพื้นที่ทำงาน”; ยังไม่มีปุ่มเริ่ม Google Login
- `/api/health` ตอบ 200 / `status=ok` เป็น liveness ของเว็บ ไม่ยืนยัน database หรือ OAuth
- `/api/bootstrap` และ `/api/auth/google` ตอบ 503 / `NOT_CONFIGURED` ไม่มี session cookie หรือสิทธิ์จำลอง
- ตรวจ `private` / `no-store`, nosniff, DENY และไม่พบค่า secrets ของ local ทั้ง 6 รายการใน responses ที่ตรวจ หลักฐาน `artifacts/vercel/initial-public-check.json` ไม่ใช่ผลตรวจ client bundles / runtime logs ทั้งระบบ
- ตรวจไฟล์ก่อน publish 142 ไฟล์ ไม่พบ local secrets; `.env.local`, credentials, dependencies, build output และ artifacts ไม่อยู่ใน Git
- ตรวจ hosted Login ด้วย Chrome session ใหม่บน viewport 1440 / 390 px ผ่าน ไม่มี page errors และเห็น setup notice ตามจริง ภาพอยู่ใน `artifacts/vercel/initial-public-1440.png` / `initial-public-390.png`; ยังไม่ใช่ผลทดสอบโทรศัพท์จริง

ยังไม่ได้ตั้ง environment variables ของแอปบน Vercel หรือคัดลอก database บนเครื่องไป cloud ไม่มีการแก้ production Base, Apps Script deployment หรือ Rich Menu production

## ขั้นถัดไปให้ Login และส่งงานได้

1. เลือก hosting environment / origin คงที่สำหรับทดสอบมือถือ และ PostgreSQL cloud แยกพร้อม region / TLS / backup
2. ตั้ง secrets ฝั่ง Vercel โดยไม่ commit, รัน migrations และ bind DB กับ test Base / environment ตาม [README](../web/README.md)
3. เตรียม OAuth client ของ origin ใหม่แยกจาก localhost / Apps Script และตรวจ Audience กับบัญชีทดสอบ
4. Redeploy แล้วตรวจ Google Login, session, kill switches, ownership และ recovery ผ่านเว็บจริงก่อนเปิด writes สำหรับ test Base
5. ทดสอบ [iPhone / Android / LINE / screen reader](vercel-device-acceptance.md) แล้วจึงรับรอง staging; cutover ต้องทำตาม [runbook](vercel-deployment-plan.md)

Vercel team ปัจจุบันเป็น Hobby ยังไม่ได้เปลี่ยนแผนหรือซื้อบริการ ตรวจความเหมาะสมของแผน / งบอีกครั้งก่อนนำระบบไปใช้งานจริง
