# เตรียม production

8 พฤศจิกายน 2026: เจ้าของยืนยันว่าทดสอบมือถือเรียบร้อยและอนุญาตดำเนินการ production แล้ว อยู่ระหว่างเตรียม deployment แบบอ่านอย่างเดียว ยังไม่สลับผู้เขียนหลักจาก Apps Script

| รายการ | ผลตรวจ |
|---|---|
| URL | `https://happy-victory-task-center.vercel.app` |
| Project / branch | `happy-victory-task-center` / `main`, root `web`, Node `24.x` |
| Neon resource | `happy-victory-production` / `store_t0dsjnqmTcsDWv5f` |
| Neon project / plan / region | `morning-dust-88866872` / `free_v3` / Singapore `sin1`; แยกจาก staging |
| Database | PostgreSQL `180006`; migrations 001/002 ผ่าน ผูก `production` กับ Base `appDS1Ji5cqIohPq3` |
| TLS | direct/pooled ใช้ `verify-full`; ตรวจ certificate และ hostname ผ่านทั้งคู่ |
| OAuth | client ใหม่ “Happy Victory Task Center — Vercel Production”; callback `/api/auth/google/callback` ตรง production origin |
| Airtable PAT | token ใหม่ เฉพาะ Base production, records read/write ไม่มี schema scope; GET `FALSE()` ทั้ง 5 ตารางผ่าน โดยไม่อ่านเนื้อหา records |
| Vercel variables | ครบ 17 ตัว เฉพาะ Production; sensitive 5 ตัว, ไม่มี direct migration URL; Preview/staging metadata ไม่เปลี่ยน |
| Writes / jobs / notifications | config และ DB writes/jobs ปิด; notifications ปิด |

ส่งออก connection ผ่านการเชื่อม integration เฉพาะ Production ชั่วคราวแล้วถอดออกก่อน pin runtime credentials ตรวจว่า resource ไม่มี auto-connected projects คงเหลือ Credentials และรายงานอยู่ใน ignored `artifacts/vercel/production-*`; ไม่เก็บค่า secret หรือข้อมูลบุคคลในเอกสารนี้

หลักฐาน: `production-db-ready.json`, `production-env-partial-ready.json` (สถานะก่อนเพิ่ม PAT) และ `production-pat-ready.json` ตรวจ source code ของ release ว่าตรงกับ `f2eb6a3` ซึ่งผ่าน [CI 42444112715](https://github.com/Burinboo256/Happy_Victory_Task_Center/actions/runs/42444112715); ยังต้องตรวจ deployment ที่สร้างด้วย production variables จริง

ลำดับต่อไป: deploy/read-only Login → backup และ restore evidence → maintenance guard/หยุดผู้เขียนเดิม → เปิด writes ระบบใหม่เพียงระบบเดียวตาม [runbook](vercel-deployment-plan.md#5-cutover-ไป-production) แผน Vercel ยังเป็น Hobby ต้องสรุปการใช้ Pro และค่าใช้จ่ายก่อนเปิดระบบงานจริง ยังไม่ซื้อบริการ ไม่เปลี่ยน Rich Menu และไม่รับรอง cutover สำเร็จจากการเตรียม credentials เพียงอย่างเดียว
