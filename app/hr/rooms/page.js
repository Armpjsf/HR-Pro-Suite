'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ResourceTable from '@/components/hr/ResourceTable';
import { authHeaders } from '@/components/hr/exportUtils';

function RoomsContent() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') === 'rooms' ? 'rooms' : 'bookings';
  const [tab, setTab] = useState(initialTab);
  const [rooms, setRooms] = useState([]);
  const [employees, setEmployees] = useState([]);

  useEffect(() => {
    fetch('/api/hr/rooms', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setRooms(d.items || []))
      .catch(() => {});

    fetch('/api/hr/employees', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setEmployees(d.employees || []))
      .catch(() => {});
  }, []);

  const roomMap = useMemo(() => {
    const map = {};
    for (const r of rooms) map[r.id] = r.name;
    return map;
  }, [rooms]);

  const empMap = useMemo(() => {
    const map = {};
    for (const e of employees) map[e.employeeId] = `${e.name} (${e.employeeId})`;
    return map;
  }, [employees]);

  const roomOptions = useMemo(() => {
    return rooms.map((r) => ({
      value: r.id,
      label: `${r.name} (จุ ${r.capacity} คน)${r.status !== 'available' ? ' [ปิดปรับปรุง]' : ''}`,
    }));
  }, [rooms]);

  return (
    <div>
      <div className="hr-tabs">
        <button className={`hr-tab${tab === 'bookings' ? ' active' : ''}`} onClick={() => setTab('bookings')}>
          📅 ตารางการจองห้องประชุม
        </button>
        <button className={`hr-tab${tab === 'rooms' ? ' active' : ''}`} onClick={() => setTab('rooms')}>
          🎦 รายชื่อห้องประชุม ({rooms.length})
        </button>
      </div>

      {tab === 'rooms' ? (
        <ResourceTable
          key="rooms"
          config={{
            resource: 'rooms',
            exportName: 'meeting_rooms',
            searchPlaceholder: 'ค้นหาห้องประชุม...',
            columns: [
              { key: 'name', label: 'ชื่อห้อง' },
              { key: 'capacity', label: 'จุได้ (คน)' },
              { key: 'equipment', label: 'อุปกรณ์' },
              {
                key: 'status', label: 'สถานะ',
                badge: { available: 'green', maintenance: 'yellow', closed: 'gray' },
                badgeLabels: { available: 'พร้อมใช้', maintenance: 'ปรับปรุง', closed: 'ปิด' },
              },
            ],
            fields: [
              { key: 'name', label: 'ชื่อห้อง', type: 'text', required: true },
              { key: 'capacity', label: 'จำนวนที่นั่ง', type: 'number' },
              { key: 'equipment', label: 'อุปกรณ์ (ทีวี/โปรเจกเตอร์ ฯลฯ)', type: 'text' },
              {
                key: 'status', label: 'สถานะ', type: 'select', default: 'available',
                options: [
                  { value: 'available', label: 'พร้อมใช้' },
                  { value: 'maintenance', label: 'ปรับปรุง' },
                  { value: 'closed', label: 'ปิด' },
                ],
              },
            ],
          }}
        />
      ) : (
        <ResourceTable
          key="bookings"
          config={{
            resource: 'bookings',
            exportName: 'room_bookings',
            searchPlaceholder: 'ค้นหาหัวข้อ / ผู้จอง / วันที่...',
            columns: [
              {
                key: 'room_id',
                label: 'ห้องประชุม',
                format: (v) => roomMap[v] || `ห้อง #${v}`,
              },
              { key: 'title', label: 'หัวข้อประชุม' },
              {
                key: 'employee_id',
                label: 'ผู้จอง',
                format: (v) => empMap[v] || v,
              },
              { key: 'book_date', label: 'วันที่' },
              {
                key: 'start_time',
                label: 'เวลาเริ่ม',
                format: (v) => (v || '').slice(0, 5),
              },
              {
                key: 'end_time',
                label: 'เวลาสิ้นสุด',
                format: (v) => (v || '').slice(0, 5),
              },
              {
                key: 'status',
                label: 'สถานะ',
                badge: { booked: 'blue', confirmed: 'green', done: 'gray', cancelled: 'red' },
                badgeLabels: { booked: 'จองแล้ว', confirmed: 'ยืนยันแล้ว', done: 'เสร็จสิ้น', cancelled: 'ยกเลิก' },
              },
            ],
            fields: [
              {
                key: 'room_id',
                label: 'ห้องประชุม',
                type: 'select',
                options: roomOptions,
                required: true,
              },
              { key: 'title', label: 'หัวข้อประชุม', type: 'text', required: true },
              { key: 'employee_id', label: 'ผู้จอง', type: 'employee', required: true },
              { key: 'book_date', label: 'วันที่', type: 'date', required: true },
              { key: 'start_time', label: 'เวลาเริ่ม', type: 'time', required: true },
              { key: 'end_time', label: 'เวลาสิ้นสุด', type: 'time', required: true },
              {
                key: 'status',
                label: 'สถานะ',
                type: 'select',
                default: 'booked',
                options: [
                  { value: 'booked', label: 'จองแล้ว' },
                  { value: 'confirmed', label: 'ยืนยันแล้ว' },
                  { value: 'done', label: 'เสร็จสิ้น' },
                  { value: 'cancelled', label: 'ยกเลิก' },
                ],
              },
            ],
            renderActions: (row, reload, showToast) => {
              const updateStatus = async (newStatus, actionLabel) => {
                try {
                  const res = await fetch(`/api/hr/bookings/${row.id}`, {
                    method: 'PUT',
                    headers: authHeaders(true),
                    body: JSON.stringify({ status: newStatus }),
                  });
                  if (res.ok) {
                    showToast(`${actionLabel}เรียบร้อยแล้ว`);
                    reload();
                  } else {
                    const d = await res.json();
                    showToast(d.error || 'ดำเนินการไม่สำเร็จ', 'error');
                  }
                } catch {
                  showToast('เชื่อมต่อไม่สำเร็จ', 'error');
                }
              };

              return (
                <div style={{ display: 'flex', gap: 4 }}>
                  {row.status === 'booked' && (
                    <button
                      className="hr-btn"
                      style={{ fontSize: 11, padding: '3px 8px', background: '#16a34a', color: '#fff', border: 'none' }}
                      onClick={() => updateStatus('confirmed', 'ยืนยันการจอง')}
                      title="กดยืนยันการจอง"
                    >
                      ✅ ยืนยัน
                    </button>
                  )}
                  {row.status !== 'cancelled' && (
                    <button
                      className="hr-btn"
                      style={{ fontSize: 11, padding: '3px 8px', background: '#ef4444', color: '#fff', border: 'none' }}
                      onClick={() => updateStatus('cancelled', 'ยกเลิกการจอง')}
                      title="กดยกเลิกการจอง"
                    >
                      ❌ ยกเลิก
                    </button>
                  )}
                </div>
              );
            },
          }}
        />
      )}
    </div>
  );
}

export default function RoomsPage() {
  return (
    <Suspense fallback={<div className="hr-empty">กำลังโหลดข้อมูลห้องประชุม...</div>}>
      <RoomsContent />
    </Suspense>
  );
}
