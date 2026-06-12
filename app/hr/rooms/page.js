'use client';

import { useState } from 'react';
import ResourceTable from '@/components/hr/ResourceTable';

export default function RoomsPage() {
  const [tab, setTab] = useState('rooms');

  return (
    <div>
      <div className="hr-tabs">
        <button className={`hr-tab${tab === 'rooms' ? ' active' : ''}`} onClick={() => setTab('rooms')}>🎦 ห้องประชุม</button>
        <button className={`hr-tab${tab === 'bookings' ? ' active' : ''}`} onClick={() => setTab('bookings')}>📅 การจอง</button>
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
            searchPlaceholder: 'ค้นหาหัวข้อ/ผู้จอง...',
            columns: [
              { key: 'room_id', label: 'ห้อง (ID)' },
              { key: 'title', label: 'หัวข้อประชุม' },
              { key: 'employee_id', label: 'ผู้จอง' },
              { key: 'book_date', label: 'วันที่' },
              { key: 'start_time', label: 'เริ่ม' },
              { key: 'end_time', label: 'ถึง' },
              {
                key: 'status', label: 'สถานะ',
                badge: { booked: 'blue', done: 'green', cancelled: 'gray' },
                badgeLabels: { booked: 'จองแล้ว', done: 'เสร็จสิ้น', cancelled: 'ยกเลิก' },
              },
            ],
            fields: [
              { key: 'room_id', label: 'รหัสห้อง (ID จากแท็บห้องประชุม)', type: 'number', required: true },
              { key: 'title', label: 'หัวข้อประชุม', type: 'text' },
              { key: 'employee_id', label: 'ผู้จอง', type: 'employee' },
              { key: 'book_date', label: 'วันที่', type: 'date', required: true },
              { key: 'start_time', label: 'เวลาเริ่ม', type: 'time', required: true },
              { key: 'end_time', label: 'เวลาสิ้นสุด', type: 'time', required: true },
              {
                key: 'status', label: 'สถานะ', type: 'select', default: 'booked',
                options: [
                  { value: 'booked', label: 'จองแล้ว' },
                  { value: 'done', label: 'เสร็จสิ้น' },
                  { value: 'cancelled', label: 'ยกเลิก' },
                ],
              },
            ],
          }}
        />
      )}
    </div>
  );
}
