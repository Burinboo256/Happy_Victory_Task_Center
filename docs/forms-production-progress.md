# สถานะคลังเอกสารและ LINE AI

อัปเดต 15 พฤศจิกายน 2569 กำลังดำเนินการตาม [แผน Production](forms-production-plan.md) Production และ Staging เผยแพร่ระบบละ 44 รายการ (Allianz 43 + Drive 1) เจ้าของยืนยันชุดทดสอบ LINE ว่า **“ใช้งานได้ iphone”** ตรวจ workflow ที่ Published จริงและสำรองไฟล์แล้ว แต่ยังไม่ถือว่าจบแผนทั้งหมด เพราะยังมีการตรวจรับจริงตามรายการท้ายเอกสาร

## ผลตรวจล่าสุด 15 พฤศจิกายน 2569

- หลังเพิ่ม Drive ใน Production เจ้าของตอบ **“ลองแล้วใช้งานได้”** ต่อขั้นตอนค้น “ขอเอกสารแบบประกัน” เปิดไฟล์ Drive และถาม “ขอเอกสารที่ฉันติดดาวไว้” บน iPhone บันทึกชุดทดสอบนี้ว่าผ่านตามคำยืนยันผู้ใช้ ไม่ใช่ผลทดสอบอัตโนมัติ และไม่ขยายผลเป็น Android/iPad หรือการแยกสิทธิ์ข้ามบัญชี
- ตรวจ alias Production ปัจจุบัน: deployment `dpl_E5v5mix6uGv1ZDSAzZyDFzYrB2MJ`, commit `32928188bdc85ab6b50e9d97b752f565a49294cb`, READY; health/forms/login 200, anonymous API 401, forged LINE signature 401, local preview 404 และ checksum migrations 010–012 ตรงไฟล์ Runtime task writes=true/jobs=false คงเดิม
- เข้า n8n ผ่านหน้าต่าง Chrome เห็น **Published** และ Export workflow `vyPOLTUkjuDepBex`, version `6c9635d8-acf5-45a7-9ec2-98c4a716c9a3` สำเร็จ เก็บที่ ignored `artifacts/vercel/n8n-live-2026-11-15.private.json` โดยไม่แก้ workflow หรือ credential
- Prompt จริงตรงกับ generator ปัจจุบันยกเว้นโมเดล: live ใช้ `openai/gpt-6-luna` ส่วนไฟล์ใน repo ใช้ `openai/gpt-6.1-sol` คงค่า live ไว้ ไม่ถือว่าความต่างนี้เป็นเหตุให้เปลี่ยนค่าที่ผู้ใช้ใช้งานเอง ทั้ง document IDs และ task IDs อยู่ใน contract จริงแล้ว
- Routing ตรงกับ repo มี node ส่งผ่าน `/api/ai/reply` เพียงหนึ่งตัว ไม่เปิด retry; raw body ของ webhook เปิดอยู่; ไม่มี pinned data; `saveDataErrorExecution=none`, `saveDataSuccessExecution=none`, `saveExecutionProgress=false`, `saveManualExecutions=false` ข้อนี้พิสูจน์การตั้งค่า ไม่ใช่หลักฐานว่าไม่มีคำตอบซ้ำใน LINE ทุกเหตุการณ์
- ตรวจลิงก์ Allianz ที่เคยค้าง: W-8BEN, W-8BEN-E และหนังสือสมัครรับเอกสารผ่านอีเมล ได้ HTTP 200 / application/pdf ตรวจภาพหน้าแรกตรงกับชื่อ จำนวนหน้า 1/8/1 ตามลำดับ เทียบกับ [หน้าแบบฟอร์มต้นทาง](https://www.allianz.co.th/th_TH/services/form-download.html) แล้ว ไม่อ้างว่าเป็นฉบับล่าสุดของบริษัทหรือแนะนำการกรอกภาษี
- สำรอง Neon ใหม่และ restore แยกเครือข่ายผ่านครบ 27 ตาราง/constraints: run `e6228d99-7bea-40ea-8120-bf8c750ec99a` ก่อนเผยแพร่ 3 รายการ เผยแพร่ผ่าน service เดิมใน transaction เดียว ตรวจ Active Admin, environment/Base, revision และ payload เดิมก่อนเขียน พร้อม audit events ผลเป็น **43 published / 0 drafts** ไม่มี Airtable record writes หรือไฟล์เอกสารในระบบ
- ตรวจบริการค้นเว็บและ AI context ด้วยข้อมูลบัญชี Active จริงสามบทบาท Admin/Secretary/Agent: ค้น W-8BEN, W-8BEN-E, รับเอกสารทางอีเมล ผ่าน 9 กรณี ตรวจ URL ฉบับปัจจุบันและ server-rendered reply แล้ว เป็น service verification แบบอ่านอย่างเดียว ไม่ใช่การส่ง LINE หรือเรียกโมเดลจริง
- เจ้าของตอบ **“ใช้งานได้ iphone”** ต่อชุดคำถาม HC1/เปิดลิงก์, มอบอำนาจ, ถามต่อรายการที่สองเมื่อมีผลอย่างน้อยสองรายการ, รายการโปรด และสรุปงานวันนี้ นับเป็นคำยืนยันชุดทดสอบบน iPhone ไม่ขยายเป็นผล Android/iPad และยังไม่มีคำยืนยันแยกเรื่องคำตอบซ้ำหรือผลรายการโปรดที่มีดาวจริง
- Snapshot ก่อนตรวจรับรอบนี้พบ AI events ย้อนหลัง 7 วัน 24 รายการอยู่ในสถานะ sent รวม document context 5 รายการ และไม่มี favorites ใน Production ขณะอ่าน ตัวเลขนี้เป็นข้อมูลรวมตามสถานะที่เว็บบันทึก ไม่ยืนยันว่าแต่ละข้อความแสดงใน LINE หรือวัด latency/ค่าใช้จ่ายได้
- เจ้าของเลือก **“ใช้ ‘แบบประกัน’ เดิม”** สำหรับ Production ตรวจลิงก์ตรงกับรายการ Staging ที่เผยแพร่และตรวจรับไว้แล้ว หน้า Drive ตอบ HTTP 200 และเป็น PDF viewer โดยไม่ redirect ไป Login จากการร้องขอสาธารณะ ไม่สรุปแทนสิทธิ์ของทุกผู้รับ
- เพิ่ม “แบบประกัน” ใน Production ผ่าน create draft/publish service ใน transaction เดียว ใช้ ID `000e0c74-2fe9-4534-a5b1-000d1aff5a97`, audience=all หลังตรวจ Active Admin/instance และ backup ที่ผ่าน restore แล้ว ตรวจเว็บค้น/AI context/server link/URL ปัจจุบันผ่านสามบทบาท รวม **44 published**; ไม่คัดลอกไฟล์หรือแก้สิทธิ์ Drive หลักฐาน `artifacts/vercel/forms-drive-production-2026-11-15.json` ระบุ `lineLive=false` เพราะเป็นผลตรวจอัตโนมัติก่อนผู้ใช้ทดสอบ ส่วนคำยืนยัน LINE บน iPhone บันทึกแยกไว้ในข้อแรก
- ตรวจ Staging พบ Drive “แบบประกัน” เผยแพร่อยู่แล้ว ไม่ได้เป็นร่างตามบันทึกเก่า จากนั้นเผยแพร่ Allianz 3 รายการที่ตรวจลิงก์แล้วผ่าน service และ revision guards ผล **44 published / 0 drafts** โดยไม่แตะ Production หลักฐาน `artifacts/vercel/forms-staging-reviewed-2026-11-15.json`
- เจ้าของแจ้ง **“ตอนนี้มีเฉพาะ iPhone”** จึงยังไม่มีเครื่อง Android/iPad สำหรับตรวจรับ ไม่ถือเป็นการอนุญาตให้ตัดเกณฑ์อุปกรณ์เหล่านั้นออกจากแผน
- ตรวจ GitHub Actions ของ commit ที่ Production ใช้อยู่ซ้ำจากสถานะจริง: [run 43386432253](https://github.com/Burinboo256/Happy_Victory_Task_Center/actions/runs/43386432253) completed/success, SHA `32928188bdc85ab6b50e9d97b752f565a49294cb` ผ่าน lint/typecheck/unit/integration/PostgreSQL/audit/build/Playwright/API/load 5 users + 250 tasks และ Apps Script regression ไม่ต้อง rerun ชุดเดิมเมื่อไม่มีการเปลี่ยน application code

หลักฐานปฏิบัติงานอยู่ใน ignored artifacts: `forms-audit-2026-11-15.json`, `forms-reviewed-publish-2026-11-15.json`, `forms-search-verification-2026-11-15.json` ใต้ `artifacts/vercel/` และ `artifacts/forms-link-review-2026-11-15/link-checks.json` เก็บเฉพาะผลตรวจและภาพตรวจในเครื่อง ไม่ใส่ credential หรือเนื้อหาเคสในรายงาน

## สรุปการตรวจเทียบแผน

| ขอบเขต | หลักฐานปัจจุบัน | สิ่งที่ยังไม่พิสูจน์ |
| --- | --- | --- |
| ข้อมูลและลิงก์ 44 รายการ | Allianz 43 + Drive “แบบประกัน” 1 รวม 44 published ทั้ง Production/Staging; เจ้าของยืนยันเปิด Drive จาก LINE บน iPhone ได้ | การเปิดบน Android/iPad ยังไม่ได้ตรวจ |
| Registry, revision, สิทธิ์, favorites | service/API/integration/PostgreSQL tests ตามประวัติด้านล่าง; บัญชีจริงสามบทบาทค้น 3 รายการใหม่ผ่าน | ผล LINE ข้ามสิทธิ์จริง ไม่ใช้ผลทดสอบจำลองแทน |
| เว็บกระชับและ link-only editor | เจ้าของยืนยัน staging “ผ่านหมด” และเว็บ “production ผ่าน” | ไม่ระบุครบทุกอุปกรณ์ตามแผน |
| LINE, prompt, memory, fallback | Export live ตรง contract; HC1, Drive และรายการโปรดในชุดทดสอบ iPhone ได้รับคำยืนยัน | การปฏิเสธข้ามสิทธิ์จริง และหลักฐานหนึ่งคำตอบต่อ event แบบเจาะจง |
| Staging แยก | Neon/Vercel/credentials แยก; ตัวอย่าง Drive อยู่ staging | ไม่มี OA ทดสอบแยก จึงยังไม่มี LINE staging end-to-end |
| Production/recovery | backup/isolated restore ล่าสุดผ่าน; checksums/public checks ผ่าน; kill-switch runbook อยู่ด้านล่าง | ระยะเวลาตอบ/ค่าใช้จ่ายโมเดล และ Android/iPad จริง |
| คู่มือ/สถาปัตยกรรม | `database-schema.md`, `forms-library.md`; คู่มือ LINE AI แยก A4 12 หน้า 46 ตัวอย่างใน `output/pdf/` | ไม่ถือว่าคู่มือพิสูจน์ผล live test |

หัวข้อถัดไปเป็นประวัติวันที่ 13 พฤศจิกายน ตัวเลข 40 published/3 drafts และข้อจำกัดการเข้าถึง Chrome ในประวัติถูกแทนด้วยผลวันที่ 15 พฤศจิกายนข้างต้น

## พัฒนาแล้ว

- คลัง `/forms` แบบแถวกระชับ ค้น/กรอง/แบ่งหน้า รายการโปรดใน Neon แยกบัญชีและ environment
- Admin/เลขาสร้างร่าง เลขาแก้เฉพาะร่างตน Admin ตรวจเผยแพร่ เปลี่ยนฉบับและพักใช้ ตรวจสิทธิ์ที่ service/API พร้อม CSRF และ optimistic revision
- ลิงก์ Allianz/Drive เท่านั้น ไม่มีอัปโหลดหรือเก็บไฟล์ เส้นทางเปิดตรวจฉบับปัจจุบันและสิทธิ์ก่อน redirect
- LINE document context v2, aliases ภาษาไทย, favorites, ถามต่อจากลำดับเอกสาร, ตรวจสิทธิ์และ version ก่อนตอบ และ fallback ที่สร้างชื่อ/ลิงก์จากทะเบียน
- migrations `010_documents.sql` และ `011_ai_documents.sql`; เพิ่มใน Neon Staging และ Production แล้ว ตรวจ checksums ตรงไฟล์และ environment/Base แยกกัน
- [คู่มือผู้ใช้และผู้ดูแล](forms-library.md) และ workflow n8n ที่สร้างจาก generator เดิม

## หลักฐานตรวจในเครื่อง

- Typecheck, Biome lint และ production build ผ่าน
- Unit 32, PGlite integration 56, PostgreSQL 11 และ root regression ผ่าน รวม test document contract ของ n8n
- API จริงบนฐานทดสอบผ่าน 20 กรณี รวม CSRF/สิทธิ์ร่าง/Inactive/redirect ปัจจุบัน และงานเดิม
- E2E ผ่าน 71 จาก 72 กรณีในการรันเต็ม อีกกรณีติดไฟล์ trace ชนกันระหว่างสองชุดทดสอบ แยก output directory แล้วตรวจกรณีเชื่อม LINE ซ้ำผ่านทั้ง desktop/mobile (2 กรณี) การจำลอง viewport ไม่เท่ากับอุปกรณ์จริง
- PostgreSQL ตรวจคำขอสร้าง/เผยแพร่พร้อมกัน การปฏิเสธ revision เก่า และ favorite ไม่ซ้ำ
- Import dry-run: 43 รายการเป็นร่างทั้งหมด รันซ้ำไม่เขียนทับข้อมูลที่แก้แล้ว
- CI commit `fd420a8` ผ่านครบทั้ง [staging](https://github.com/Burinboo256/Happy_Victory_Task_Center/actions/runs/43318856746) และ [main](https://github.com/Burinboo256/Happy_Victory_Task_Center/actions/runs/43320357994): lint, typecheck, unit/integration/PostgreSQL, audit, build, E2E, API และโหลดจำลอง 5 คน/250 งาน

## Staging และรายการรอตรวจ

Vercel/Neon แยกจาก Production ตรวจ instance/Base และ migration ก่อนเขียนแล้ว ใช้ feature flags `FORMS_ENABLED` และ `AI_FORMS_ENABLED`; ค่าเริ่มต้น false

นำเข้า Staging 43 รายการ เผยแพร่ 40 รายการ และคง 3 ลิงก์รอตรวจเป็นร่าง เพิ่ม Drive **แบบประกัน** เป็นร่างอีก 1 รายการ ตั้ง `FORMS_ENABLED=true` เฉพาะ Preview branch staging แล้ว Deploy `fd420a8` เป็น `dpl_2UCDtMwfGWibhNf1LB7vqmacFFDD` พร้อมผูก alias เดิมให้ตรง ตรวจ public endpoints และ checksum ผ่าน

เจ้าของตอบ **“ผ่านหมด”** ต่อรายการทดสอบ Admin/เลขา/Agent: ค้น HC1 เปิดเอกสาร ติดดาว/โหลดใหม่ เพิ่มร่าง และเปิด Drive ตัวอย่าง ผลนี้เป็นคำยืนยันของเจ้าของ ไม่ใช่การตรวจอุปกรณ์จริงโดยเครื่องมือ

- แหล่ง Allianz 40 ลิงก์ตรวจได้จากงาน Local; 3 ลิงก์ยังรอตรวจ ได้แก่รับเอกสารผ่านอีเมล, W-8BEN และ W-8BEN-E เครื่องมือรายงาน cache miss จึงเก็บเป็นร่าง ไม่สรุปว่าไฟล์เสีย
- ได้ลิงก์ Drive ตัวอย่างชื่อ **แบบประกัน** และคำยืนยันผลทดสอบจากเจ้าของแล้ว เก็บ URL เฉพาะ Staging/ไฟล์ปฏิบัติงานที่ Git ignore ไม่ย้ายรายการทดสอบนี้หรือดาวทดสอบเข้า Production อัตโนมัติ
- เจ้าของแจ้งว่ายังไม่มี OA ทดสอบแยก จึงยังไม่ผ่าน LINE end-to-end บน Staging ห้ามนับการทดสอบจำลองเป็นผลจริงหรือย้าย webhook OA Production มาทดสอบ
- ช่องเชื่อมต่อ Chrome ไม่พร้อมเมื่อเข้าตรวจ Drive/n8n จึงยังไม่มีผลตรวจ UI ของสองบริการนั้นรอบนี้
- เจ้าของยืนยันอัปเดต HTTP Request node ที่เรียก OpenRouter และกด Publish แล้ว แต่เครื่องมือยังตรวจ workflow/settings/ไฟล์สำรองใน n8n ไม่ได้; ไม่ถือว่าผลทดสอบเว็บแทนผล LINE

## Production ส่วนเว็บ

- สำรอง Neon แบบ snapshot อ่านอย่างเดียวเข้ารหัสและ restore ใน Docker `--network=none` ผ่าน 23 ตาราง/constraints พร้อมปฏิเสธ archive ที่เสียหาย Run `b490cc43-510b-4709-9e0a-3d13e6b65d8b` เก็บไฟล์และกุญแจใน ignored private artifacts แยกกัน
- นำเข้า 43 ร่าง แล้วเผยแพร่ 40 รายการที่ตรวจแล้ว อีก 3 รายการยังเป็นร่าง ไม่มี Airtable record writes หรือไฟล์เอกสารที่เก็บในระบบ
- Deploy code `fd420a8` จาก main โดยเริ่มปิด flags แล้วเปิดเฉพาะ `FORMS_ENABLED=true` และ redeploy เป็น `dpl_A8X5Geb527XU31LmfQUpCqMAfwuK` READY; `https://happy-victory-task-center.vercel.app/forms`
- หลังเจ้าของรายงาน AI ตอบว่าค้นได้เฉพาะงาน ตรวจ Vercel พบ `AI_FORMS_ENABLED=false` จึงเปิดเป็น `true` หลังเจ้าของยืนยัน Publish n8n แล้ว และ redeploy เป็น `dpl_HpMxhF8Lj1XguU4NRajhKoNrRMj2` READY ที่ alias Production เดิม (commit `fd420a8`) เวลา 12:54 น. Asia/Bangkok เพื่อทดสอบ OA จริง ไม่เปลี่ยน credential หรือ webhook ของสอง OA
- ตรวจหลังเปิด flag: health/forms/login, anonymous access, forged signature, migration checksums และ environment/Base ผ่าน; เอกสาร 40 published/3 drafts, task writes=true/jobs=false คงเดิม หลักฐานอัตโนมัติ `artifacts/vercel/forms-production-release.json` ระบุ `lineLive=false` เพราะไม่ได้ส่งข้อความ LINE ในสคริปต์
- เจ้าของยืนยัน **“ได้รับเอกสารแล้ว”** หลังส่งคำถาม HC1 ใหม่ใน OA `@672vhuss` ถือว่าค้นและรับเอกสารผ่าน LINE Production ผ่านตามคำยืนยันผู้ใช้ ยังไม่ยืนยันการเปิดลิงก์, favorites, การถามต่อ, สิทธิ์ข้ามบัญชี หรือสรุป/ร่างงานเดิมจากผลนี้
- Public checks ผ่าน: health/login/forms 200, anonymous forms/bootstrap/AI account 401, forged AI signature 401, Local preview 404; runtime task writes=true/jobs=false คงเดิม เจ้าของยืนยัน **“production ผ่าน”** หลังลองรายการ ค้น HC1 เปิดเอกสาร และติดดาว/โหลดใหม่ด้วยบัญชีจริง

## ประวัติ semantic search และรายการตรวจรับ

ปรับปรุงเผยแพร่ commit `1d9df11` แล้ว: คำถาม “มีฟอร์มเกี่ยวกับ มอบอำนาจ ตัวแทนไหม” จะใช้ AI เลือกจาก metadata ที่อนุญาตเมื่อค้นตรงคำไม่พบ รองรับ contract v2/HTTP Request เดิม ไม่มี migration ใหม่; ผลจำกัด 5 รายการ ไม่แต่งลิงก์และไม่ส่งทั้งคลังเมื่อ AI ตอบไม่ได้ รหัสตรงและ favorites ยังใช้การค้นเดิม Lint/typecheck/build, unit 32 และ integration 61 ผ่าน; หลังปรับ alias ให้รักษารายละเอียดประเภทกรมธรรม์ ตรวจชุด AI documents ซ้ำผ่าน 10 กรณี และ [CI ชุดเต็ม](https://github.com/Burinboo256/Happy_Victory_Task_Center/actions/runs/43383494056) ผ่านก่อน push main

Staging `dpl_7tNyP7SDPGXkPEQTvdUbmye8ZFjy` และ Production `dpl_5tJgCQqQFdJs5Bg2YXghAgBbfdBh` READY ตรวจ alias/SHA/public endpoints/สิทธิ์ anonymous/signature และ migration checksums ผ่าน เวลา 13:14 น. Asia/Bangkok Production ยังมี 40 published/3 drafts และ runtime เดิม ไม่แก้ n8n/credential/webhook เพิ่ม ผลทดสอบเลือกเอกสารใช้โมเดลจำลอง จึงยังรอผู้ใช้ลองคำถามมอบอำนาจจริงก่อนยืนยันผลโมเดลบน LINE

### ผลตรวจรับและงานคงเหลือวันที่ 15 พฤศจิกายน

สถานะตรวจรับครบแผน: **รอข้อมูลภายนอก (blocked)** ไม่ใช่การปิดฟีเจอร์ Production เจ้าของยืนยันชุดทดสอบ “แบบประกัน”/รายการโปรดบน iPhone ใช้งานได้แล้ว แต่มีเฉพาะ iPhone และยังไม่มี OA ทดสอบแยก ตรวจ LINE Desktop เพิ่มพบหน้าที่มีช่องเข้าสู่ระบบและจับภาพไม่ได้ (`window crop is outside captured monitor`) จึงยังไม่เกิด desktop smoke test ไม่มีการส่งข้อความหรือสร้าง session แทนเจ้าของ

เมื่อมีผลทดสอบหรืออุปกรณ์/ช่องทดสอบพร้อม ให้ดำเนินการตามรายการด้านล่างต่อ เก็บหลักฐานแยกตามบทบาท อุปกรณ์ และ environment โดยคงเกณฑ์ในแผนเดิมไว้

1. ผ่านตามคำยืนยันเจ้าของ: ค้น “แบบประกัน” และเปิด Drive ผ่าน LINE บน iPhone หลังเผยแพร่ใน Production
2. ผ่านชุดทดสอบรายการโปรดบน iPhone ตามคำยืนยันเจ้าของ; ยังเหลือตรวจว่าไม่มีรายการโปรดของบัญชีอื่นด้วยบัญชีจริงคนละบัญชี
3. ตรวจการปฏิเสธเอกสารนอกสิทธิ์บน LINE และ regression ร่างงานเดิม พร้อมยืนยันหนึ่งคำตอบต่อ event; integration tests เดิมผ่านแต่ไม่ใช้แทนผล OA จริง
4. ตรวจ Android และ iPad จริง รวมเปิดลิงก์กลับหลัง Google Login; ขณะนี้มีคำยืนยัน iPhone เท่านั้น
5. ยังไม่มี OA ทดสอบแยก ไม่ย้าย webhook Production ไป staging และไม่รายงานว่า LINE staging ผ่าน ต้องมีผลตรวจแยกหรือการตกลงปรับเกณฑ์จากเจ้าของก่อนปิดข้อกำหนดนี้
6. เฝ้าดูเวลาและข้อผิดพลาดจากผลจริงและประเมินการใช้ Neon/OpenRouter โดยไม่เปิดเก็บเนื้อหาเคสเพื่อให้ได้ตัวเลข ไม่ถือว่าสถานะ sent เพียงอย่างเดียวพิสูจน์ประสิทธิภาพหรือค่าใช้จ่าย

## การนำเข้าและย้อนกลับ

จาก `web/` ใช้ `npm run forms:import` ตรวจข้อมูลโดยไม่เชื่อมฐานข้อมูล; การเขียนจริงใช้ `npm run forms:import -- --apply --admin-email=<Active Admin email>` ภายใต้ environment ที่ตั้งถูกต้อง คำสั่งนำเข้าไม่เผยแพร่และไม่แทนค่ารายการเดิม

ปิด `AI_FORMS_ENABLED` และ redeploy เพื่อหยุดค้นเอกสารผ่าน LINE; ปิด `FORMS_ENABLED` เพิ่มเพื่อปิดเว็บ คงตาราง/ฉบับ/ดาวไว้ ไม่ drop ตารางหรือ restore ทับงานใหม่ OA แจ้งเตือน `@688rmrty` และ Airtable Tasks ไม่เปลี่ยนจากฟีเจอร์นี้
