'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Brand } from '../brand';
import {
  categories,
  initialDocuments,
  sourcePage,
  type Category,
  type FormDocument,
  type Version,
} from './data';
import styles from './forms-preview.module.css';

type Role = 'Admin' | 'Secretary' | 'Agent';
type Modal =
  | { kind: 'details'; docId: string }
  | { kind: 'edit'; docId?: string }
  | { kind: 'review'; docId: string; versionId: string };
const roleLabels: Record<Role, string> = { Admin: 'Admin', Secretary: 'เลขา', Agent: 'ตัวแทน' };
const favoritesKey = 'rinlyn.local.forms.favorites.v1';
const formatDate = (date: string) =>
  date
    ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(
        new Date(`${date}T12:00:00+07:00`),
      )
    : 'ยังไม่ระบุ';

function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="forms-dialog-title"
      onCancel={close}
    >
      <div className={styles.dialogHeading}>
        <h2 id="forms-dialog-title">{title}</h2>
        <button type="button" className={styles.secondary} onClick={close}>
          ปิด
        </button>
      </div>
      {children}
    </dialog>
  );
}

function FileLink({ version, compact = false }: { version: Version; compact?: boolean }) {
  return (
    <a
      className={styles.primary}
      href={version.url}
      target="_blank"
      rel="noopener noreferrer"
      download={version.source === 'upload' ? version.fileName : undefined}
      aria-label={version.source === 'upload' ? 'ดาวน์โหลด PDF' : 'เปิด / ดาวน์โหลด PDF'}
    >
      {compact || version.source === 'upload' ? 'ดาวน์โหลด PDF' : 'เปิด / ดาวน์โหลด PDF'}{' '}
      <span aria-hidden="true">↗</span>
    </a>
  );
}

function Editor({
  doc,
  save,
  cancel,
}: {
  doc?: FormDocument;
  save: (value: {
    title: string;
    category: Category;
    description: string;
    version: Version;
  }) => void;
  cancel: () => void;
}) {
  const [source, setSource] = useState<'official' | 'upload'>('official');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const latest = doc?.versions.find((v) => v.id === doc.currentId);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity() || busy) return;
    const fields = new FormData(form);
    setError('');
    setBusy(true);
    try {
      const title = String(fields.get('title') || '').trim();
      const label = String(fields.get('label') || '').trim();
      const note = String(fields.get('note') || '').trim();
      if (!title || !label || !note) throw new Error('กรอกชื่อเอกสาร ชื่อฉบับ และสิ่งที่เปลี่ยนให้ครบ');
      const category = String(fields.get('category')) as Category;
      if (!categories.includes(category)) throw new Error('เลือกหมวดเอกสาร');
      let url = '',
        fileName: string | undefined;
      if (source === 'official') {
        const parsed = new URL(String(fields.get('url') || ''));
        if (
          parsed.protocol !== 'https:' ||
          parsed.username ||
          parsed.password ||
          !['www.allianz.co.th', 'allianz.co.th', 'www.azay.co.th', 'azay.co.th'].includes(
            parsed.hostname,
          )
        )
          throw new Error('ใช้ลิงก์ HTTPS ของ allianz.co.th หรือ azay.co.th');
        url = parsed.href;
      } else {
        const file = fields.get('file');
        if (!(file instanceof File) || !file.size) throw new Error('เลือกไฟล์ PDF ก่อนบันทึก');
        if (file.size > 15 * 1024 * 1024) throw new Error('ไฟล์ต้องไม่เกิน 15 MB');
        if (
          !file.name.toLowerCase().endsWith('.pdf') ||
          (await file.slice(0, 5).text()) !== '%PDF-'
        )
          throw new Error('ไฟล์ที่เลือกไม่ใช่ PDF');
        url = URL.createObjectURL(file);
        fileName = file.name;
      }
      save({
        title,
        category,
        description: String(fields.get('description') || '').trim(),
        version: {
          id: crypto.randomUUID(),
          label,
          url,
          source,
          fileName,
          effectiveDate: String(fields.get('effectiveDate') || ''),
          note,
          status: 'draft',
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกร่างไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className={styles.form} onSubmit={submit}>
      <p className={styles.hint}>บันทึกเป็นร่างก่อน ผู้ใช้อื่นจะเห็นเมื่อเผยแพร่ในตัวอย่างนี้แล้ว</p>
      <label>
        <span className={styles.fieldLabel}>
          ชื่อเอกสาร <b>*</b>
        </span>
        <input name="title" defaultValue={doc?.title} required maxLength={180} readOnly={!!doc} />
      </label>
      <label>
        หมวดเอกสาร
        <select
          aria-label="หมวดเอกสาร"
          name="category"
          defaultValue={doc?.category || categories[0]}
          disabled={!!doc}
        >
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      {doc && <input type="hidden" name="category" value={doc.category} />}
      <label>
        คำอธิบายสั้น ๆ
        <textarea
          name="description"
          defaultValue={doc?.description}
          maxLength={500}
          rows={2}
          readOnly={!!doc}
        />
      </label>
      <div className={styles.twoColumns}>
        <label>
          <span className={styles.fieldLabel}>
            ชื่อฉบับในระบบ <b>*</b>
          </span>
          <input name="label" required maxLength={100} placeholder="เช่น ฉบับตรวจทาน พ.ย. 2569" />
        </label>
        <label>
          วันที่เริ่มใช้ตามเอกสาร
          <input type="date" name="effectiveDate" />
        </label>
      </div>
      <p className={styles.hint}>
        ชื่อฉบับใช้จัดการภายในทีม ไม่ใช่เลขเวอร์ชันที่บริษัทรับรอง หากยังไม่ทราบวันที่เริ่มใช้ ให้เว้นไว้
      </p>
      <label>
        แหล่งเอกสาร
        <select
          aria-label="แหล่งเอกสาร"
          value={source}
          onChange={(e) => {
            setSource(e.target.value as 'official' | 'upload');
            setError('');
          }}
        >
          <option value="official">ลิงก์ทางการ Allianz</option>
          <option value="upload">เลือกไฟล์ PDF จากเครื่อง</option>
        </select>
      </label>
      {source === 'official' ? (
        <label>
          <span className={styles.fieldLabel}>
            ลิงก์เอกสาร <b>*</b>
          </span>
          <input
            name="url"
            type="url"
            required
            placeholder="https://www.allianz.co.th/…"
            defaultValue={latest?.source === 'official' ? latest.url : ''}
          />
        </label>
      ) : (
        <label>
          <span className={styles.fieldLabel}>
            ไฟล์ PDF <b>*</b>
          </span>
          <input type="file" name="file" accept="application/pdf,.pdf" required />
          <small>ไม่เกิน 15 MB • ไฟล์อยู่เฉพาะในเบราว์เซอร์ ไม่ถูกอัปโหลดไปเซิร์ฟเวอร์</small>
        </label>
      )}
      <label>
        <span className={styles.fieldLabel}>
          สิ่งที่เปลี่ยน / เหตุผลที่เพิ่ม <b>*</b>
        </span>
        <textarea
          name="note"
          required
          maxLength={800}
          rows={3}
          placeholder="อธิบายให้ทีมทราบว่าฉบับนี้เปลี่ยนอะไร"
        />
      </label>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button className={styles.secondary} type="button" onClick={cancel}>
          ยกเลิก
        </button>
        <button type="submit" className={styles.primary} disabled={busy}>
          {busy ? 'กำลังตรวจไฟล์…' : 'บันทึกเป็นร่าง'}
        </button>
      </div>
    </form>
  );
}

export function FormsPreview() {
  const [docs, setDocs] = useState(initialDocuments);
  const [role, setRole] = useState<Role>('Admin');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ทั้งหมด');
  const [tab, setTab] = useState<'published' | 'draft' | 'favorites'>('published');
  const [favorites, setFavorites] = useState<string[]>([]);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(favoritesKey) || '[]');
      if (Array.isArray(saved)) {
        setFavorites(
          [...new Set(saved.filter((id): id is string => typeof id === 'string'))].slice(0, 1000),
        );
      }
    } catch {
      // Favorites still work for this session when browser storage is unavailable.
    }
  }, []);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const libraryRef = useRef<HTMLElement>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [message, setMessage] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [updated, setUpdated] = useState<string[]>([]);
  const blobs = useRef<string[]>([]);
  useEffect(
    () => () => {
      for (const url of blobs.current) URL.revokeObjectURL(url);
    },
    [],
  );
  const admin = role === 'Admin';
  const publishedCount = docs.filter((d) => d.currentId).length;
  const favoriteCount = docs.filter((d) => d.currentId && favorites.includes(d.id)).length;
  function toggleFavorite(id: string) {
    const next = favorites.includes(id)
      ? favorites.filter((value) => value !== id)
      : [...favorites, id];
    setFavorites(next);
    try {
      localStorage.setItem(favoritesKey, JSON.stringify(next));
    } catch {
      setMessage('ใช้รายการโปรดได้ในรอบนี้ แต่เบราว์เซอร์ไม่อนุญาตให้จำหลังรีโหลด');
    }
  }
  function matchesTab(d: FormDocument) {
    if (tab === 'draft' && admin) return d.versions.some((v) => v.status === 'draft');
    return !!d.currentId && (tab !== 'favorites' || favorites.includes(d.id));
  }
  const drafts = docs.reduce(
    (sum, d) => sum + d.versions.filter((v) => v.status === 'draft').length,
    0,
  );
  const filtered = docs.filter(
    (d) =>
      matchesTab(d) &&
      (category === 'ทั้งหมด' || category === d.category) &&
      `${d.title} ${d.description} ${d.keywords}`
        .toLocaleLowerCase('th')
        .includes(search.trim().toLocaleLowerCase('th')),
  );
  const selected = modal && 'docId' in modal ? docs.find((d) => d.id === modal.docId) : undefined;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  function changePage(next: number) {
    setPage(next);
    libraryRef.current?.scrollIntoView({ block: 'start' });
  }
  const reviewVersion =
    modal?.kind === 'review'
      ? selected?.versions.find((v) => v.id === modal.versionId && v.status === 'draft')
      : undefined;
  function openReview(docId: string, versionId: string) {
    setReviewed(false);
    setModal({ kind: 'review', docId, versionId });
  }
  function saveDraft(value: {
    title: string;
    category: Category;
    description: string;
    version: Version;
  }) {
    if (!admin) return;
    if (value.version.source === 'upload') blobs.current.push(value.version.url);
    const docId = selected?.id || crypto.randomUUID();
    setDocs((current) =>
      selected
        ? current.map((d) =>
            d.id === docId ? { ...d, versions: [value.version, ...d.versions] } : d,
          )
        : [
            {
              id: docId,
              title: value.title,
              category: value.category,
              description: value.description,
              keywords: '',
              currentId: null,
              versions: [value.version],
            },
            ...current,
          ],
    );
    setMessage('บันทึกร่างในตัวอย่างแล้ว ยังไม่เปลี่ยนฉบับที่ผู้ใช้เห็น');
    setSearch('');
    setCategory('ทั้งหมด');
    setTab('draft');
    setPage(1);
    openReview(docId, value.version.id);
  }
  function publish() {
    if (!admin || !reviewed || !selected || !reviewVersion) return;
    setDocs((current) =>
      current.map((d) =>
        d.id === selected.id
          ? {
              ...d,
              currentId: reviewVersion.id,
              versions: d.versions.map((v) =>
                v.id === reviewVersion.id
                  ? { ...v, status: 'published' }
                  : v.status === 'published'
                    ? { ...v, status: 'archived' }
                    : v,
              ),
            }
          : d,
      ),
    );
    setUpdated((current) => [...new Set([...current, selected.id])]);
    setModal(null);
    setTab('published');
    setPage(1);
    setMessage('เผยแพร่ในตัวอย่างแล้ว ปุ่มดาวน์โหลดเปลี่ยนเป็นฉบับที่เลือก และเก็บประวัติเดิมไว้');
  }
  return (
    <div className={styles.app}>
      <aside className={styles.sidebar}>
        <Brand />
        <p className={styles.navLabel}>พื้นที่ทำงาน</p>
        <div className={styles.navItem}>◫ ภาพรวมงาน</div>
        <div className={styles.navItem}>▤ รายการงาน</div>
        <div className={styles.activeNav} aria-current="page">
          ▧ เอกสารและแบบฟอร์ม
        </div>
        <div className={styles.sidebarFoot}>
          พร้อมใช้เอกสารฉบับเดียวกัน
          <br />
          <strong>ทั้งทีม ในที่เดียว</strong>
        </div>
      </aside>
      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <span>
            RINLYN Secretary <span aria-hidden="true"> / </span> คลังเอกสาร
          </span>
          <span className={styles.avatar}>{roleLabels[role]}</span>
        </header>
        <main className={styles.content}>
          <section className={styles.previewBar} aria-label="ควบคุมตัวอย่าง">
            <div>
              <strong>ตัวอย่างบนเครื่อง · ครบ 43 รายการประกันชีวิต</strong>
              <p>รายการโปรดจำในเบราว์เซอร์นี้ · การแก้ไขเอกสารรีเซ็ตเมื่อรีโหลด</p>
            </div>
            <label>
              ลองมุมมอง
              <select
                aria-label="ลองมุมมอง"
                value={role}
                onChange={(e) => {
                  setRole(e.target.value as Role);
                  setPage(1);
                  setTab('published');
                  setModal(null);
                  setMessage('');
                }}
              >
                {Object.entries(roleLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <div className={styles.heading}>
            <div>
              <h1>เอกสารและแบบฟอร์ม</h1>
              <p>ประกันชีวิต · ค้นหาและดาวน์โหลดฉบับปัจจุบัน</p>
            </div>
            {admin && (
              <button
                type="button"
                className={styles.primary}
                onClick={() => setModal({ kind: 'edit' })}
              >
                + เพิ่มเอกสาร
              </button>
            )}
          </div>
          {message && (
            <p className={styles.success} role="status">
              {message}
            </p>
          )}
          <section ref={libraryRef} className={styles.library} aria-label="รายการเอกสาร">
            <div className={styles.tabs}>
              <button
                type="button"
                aria-pressed={tab === 'published'}
                onClick={() => {
                  setTab('published');
                  setPage(1);
                }}
              >
                พร้อมดาวน์โหลด <span>{publishedCount}</span>
              </button>
              <button
                type="button"
                aria-pressed={tab === 'favorites'}
                onClick={() => {
                  setTab('favorites');
                  setPage(1);
                  setSearch('');
                  setCategory('ทั้งหมด');
                }}
              >
                <span className={styles.tabStar} aria-hidden="true">
                  ★
                </span>{' '}
                ใช้บ่อย <span>{favoriteCount}</span>
              </button>
              {admin && (
                <button
                  type="button"
                  aria-pressed={tab === 'draft'}
                  onClick={() => {
                    setTab('draft');
                    setPage(1);
                  }}
                >
                  ร่างรอตรวจ <span>{drafts}</span>
                </button>
              )}
            </div>
            <div className={styles.filters}>
              <label className={styles.search}>
                ค้นหาเอกสาร
                <input
                  type="search"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="ค้นชื่อเอกสาร เช่น ขอประวัติ, HC1, หักบัญชี"
                />
              </label>
              <label>
                หมวดเอกสาร
                <select
                  aria-label="หมวดเอกสาร"
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setPage(1);
                  }}
                >
                  <option>ทั้งหมด</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c} ({docs.filter((d) => d.category === c && matchesTab(d)).length})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className={styles.resultCount}>
              พบ {filtered.length} เอกสาร
              {filtered.length > 0 &&
                ` · แสดง ${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, filtered.length)}`}{' '}
              <span>• หน้าละ 10 รายการ</span>
            </p>
            <div className={styles.grid}>
              {visible.map((doc) => {
                const current = doc.versions.find((v) => v.id === doc.currentId);
                const pending = doc.versions.filter((v) => v.status === 'draft');
                return (
                  <article key={doc.id} className={styles.card} aria-label={doc.title}>
                    {current ? (
                      <button
                        type="button"
                        className={styles.favoriteButton}
                        aria-label={`${favorites.includes(doc.id) ? 'นำออกจาก' : 'เพิ่มใน'}รายการโปรด: ${doc.title}`}
                        aria-pressed={favorites.includes(doc.id)}
                        title={
                          favorites.includes(doc.id) ? 'นำออกจากรายการโปรด' : 'เพิ่มในรายการโปรด'
                        }
                        onClick={() => toggleFavorite(doc.id)}
                      >
                        <span aria-hidden="true">{favorites.includes(doc.id) ? '★' : '☆'}</span>
                      </button>
                    ) : (
                      <span className={styles.pdfIcon} aria-hidden="true">
                        PDF
                      </span>
                    )}
                    <div className={styles.documentInfo}>
                      <h2>{doc.title}</h2>
                      <div className={styles.documentMeta}>
                        <span className={styles.category}>{doc.category}</span>
                        <span>
                          {current
                            ? updated.includes(doc.id)
                              ? current.label
                              : `PDF${doc.size ? ` · ${doc.size}` : ''}`
                            : 'ยังไม่มีฉบับเผยแพร่'}
                        </span>
                        {updated.includes(doc.id) && (
                          <span className={styles.updated}>อัปเดตแล้ว</span>
                        )}
                        {doc.needsLinkReview && !updated.includes(doc.id) && (
                          <span className={styles.draftBadge}>รอตรวจลิงก์</span>
                        )}
                      </div>
                    </div>
                    {tab === 'draft' &&
                      pending.map((v) => (
                        <div className={styles.draftRow} key={v.id}>
                          <span>ร่าง: {v.label}</span>
                          <button
                            type="button"
                            className={styles.textButton}
                            onClick={() => openReview(doc.id, v.id)}
                          >
                            ตรวจและเผยแพร่
                          </button>
                        </div>
                      ))}
                    <div className={styles.cardActions}>
                      {current && tab !== 'draft' && <FileLink version={current} compact />}
                      <button
                        type="button"
                        className={styles.secondary}
                        aria-label={admin ? 'รายละเอียด / เวอร์ชัน' : 'รายละเอียด'}
                        onClick={() => setModal({ kind: 'details', docId: doc.id })}
                      >
                        รายละเอียด
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            {pageCount > 1 && (
              <nav className={styles.pagination} aria-label="หน้าเอกสาร">
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={currentPage === 1}
                  onClick={() => changePage(currentPage - 1)}
                >
                  ก่อนหน้า
                </button>
                <span aria-live="polite">
                  หน้า {currentPage} / {pageCount}
                </span>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={currentPage === pageCount}
                  onClick={() => changePage(currentPage + 1)}
                >
                  ถัดไป
                </button>
              </nav>
            )}
            {!filtered.length && (
              <div className={styles.empty}>
                <strong>
                  {tab === 'draft'
                    ? 'ยังไม่มีร่างรอตรวจ'
                    : tab === 'favorites' && favoriteCount === 0
                      ? 'ยังไม่มีเอกสารใช้บ่อย'
                      : 'ไม่พบเอกสารที่ค้นหา'}
                </strong>
                <p>
                  {tab === 'draft'
                    ? 'เพิ่มเอกสารหรือฉบับใหม่ แล้วกลับมาตรวจและเผยแพร่ที่นี่'
                    : tab === 'favorites' && favoriteCount === 0
                      ? 'กดดาวข้างเอกสารที่ใช้ประจำ แล้วกลับมาเปิดได้เร็วจากหน้านี้'
                      : 'ลองค้นด้วยคำสั้น ๆ หรือเลือกหมวดทั้งหมด'}
                </p>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => {
                    if (tab === 'favorites' && favoriteCount === 0) setTab('published');
                    setSearch('');
                    setCategory('ทั้งหมด');
                    setPage(1);
                  }}
                >
                  {tab === 'favorites' && favoriteCount === 0 ? 'เลือกเอกสารใช้บ่อย' : 'ล้างตัวกรอง'}
                </button>
              </div>
            )}
          </section>
          <footer className={styles.footer}>
            ชื่อเอกสารและลิงก์อ้างอิงจาก{' '}
            <a href={sourcePage} target="_blank" rel="noopener noreferrer">
              หน้าแบบฟอร์มทางการ Allianz ↗
            </a>
            <br />
            เฉพาะส่วนประกันชีวิต: ทั่วไป 22 · ยูนิต ลิงค์ 14 · ฝ่ายพิจารณา 2 · FATCA &amp; CRS 5
            <br />
            ยังไม่มีระบบอัปเดตอัตโนมัติ • 3 รายการรอตรวจลิงก์ • เลขฉบับและวันที่เริ่มใช้ยังไม่ได้ตรวจรับรอง
          </footer>
        </main>
      </div>
      {modal && (
        <Dialog
          title={
            modal.kind === 'edit'
              ? selected
                ? 'เพิ่มฉบับใหม่'
                : 'เพิ่มเอกสาร'
              : modal.kind === 'review'
                ? 'ตรวจร่างก่อนเผยแพร่'
                : 'รายละเอียดและฉบับเอกสาร'
          }
          close={() => setModal(null)}
        >
          {modal.kind === 'edit' && admin && (
            <Editor doc={selected} save={saveDraft} cancel={() => setModal(null)} />
          )}
          {modal.kind === 'review' && admin && selected && reviewVersion && (
            <div className={styles.detail}>
              <span className={styles.category}>ร่าง • ยังไม่เผยแพร่</span>
              <h3>{selected.title}</h3>
              <dl>
                <dt>ฉบับที่จะเผยแพร่</dt>
                <dd>{reviewVersion.label}</dd>
                <dt>วันที่เริ่มใช้ตามเอกสาร</dt>
                <dd>{formatDate(reviewVersion.effectiveDate)}</dd>
                <dt>สิ่งที่เปลี่ยน</dt>
                <dd>{reviewVersion.note}</dd>
              </dl>
              <FileLink version={reviewVersion} />
              <p className={styles.hint}>
                เปิดเอกสารตรวจชื่อและเนื้อหาก่อนเผยแพร่ การเผยแพร่ครั้งนี้มีผลเฉพาะตัวอย่างบนเครื่อง
              </p>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                ฉันตรวจเอกสารแล้ว และเลือกฉบับนี้เป็นฉบับปัจจุบันในตัวอย่าง
              </label>
              <button
                type="button"
                className={styles.primary}
                disabled={!reviewed}
                onClick={publish}
              >
                เผยแพร่ฉบับนี้
              </button>
            </div>
          )}
          {modal.kind === 'details' && selected && (
            <div className={styles.detail}>
              <span className={styles.category}>{selected.category}</span>
              <h3>{selected.title}</h3>
              <p>{selected.description}</p>
              {selected.versions
                .filter((v) => admin || v.id === selected.currentId)
                .map((v) => (
                  <section className={styles.historyItem} key={v.id}>
                    <div>
                      <strong>{v.label}</strong>
                      <span
                        className={v.status === 'draft' ? styles.draftBadge : styles.historyBadge}
                      >
                        {v.status === 'published'
                          ? 'ฉบับปัจจุบัน'
                          : v.status === 'draft'
                            ? 'ร่าง'
                            : 'ประวัติเดิม'}
                      </span>
                    </div>
                    <p>{v.note}</p>
                    <p className={styles.hint}>วันที่เริ่มใช้: {formatDate(v.effectiveDate)}</p>
                    {v.status === 'draft' ? (
                      <button
                        type="button"
                        className={styles.secondary}
                        onClick={() => openReview(selected.id, v.id)}
                      >
                        ตรวจและเผยแพร่
                      </button>
                    ) : (
                      <FileLink version={v} />
                    )}
                  </section>
                ))}
              <p className={styles.hint}>
                ประวัติลิงก์เก่าไม่ใช่สำเนา PDF ถาวร หากบริษัทเปลี่ยนไฟล์ใน URL เดิม เนื้อหาที่เปิดอาจเปลี่ยนได้
              </p>
              {admin && (
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => setModal({ kind: 'edit', docId: selected.id })}
                >
                  + เพิ่มฉบับใหม่
                </button>
              )}
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}
