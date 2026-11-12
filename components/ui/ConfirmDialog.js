'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import AppIcon from './Icons';

// Singleton event handler for imperative calls
let dialogHandler = null;

/**
 * Imperative confirm dialog returning Promise<boolean>
 * Usage:
 *   const ok = await confirmDialog('ต้องการลบรายการนี้ใช่หรือไม่?');
 *   // or
 *   const ok = await confirmDialog({
 *     title: 'ยืนยันการลบ',
 *     message: 'ข้อมูลที่ลบจะไม่สามารถกู้คืนได้',
 *     confirmLabel: 'ลบข้อมูล',
 *     cancelLabel: 'ยกเลิก',
 *     destructive: true,
 *   });
 */
export function confirmDialog(optionsOrMessage) {
  let opts = {};
  if (typeof optionsOrMessage === 'string') {
    opts = { message: optionsOrMessage };
  } else if (optionsOrMessage && typeof optionsOrMessage === 'object') {
    opts = { ...optionsOrMessage };
  }

  const {
    title = 'ยืนยันการดำเนินการ',
    message = '',
    confirmLabel = 'ยืนยัน',
    cancelLabel = 'ยกเลิก',
    destructive = false,
  } = opts;

  if (dialogHandler && dialogHandler.showConfirm) {
    return dialogHandler.showConfirm({
      title,
      message,
      confirmLabel,
      cancelLabel,
      destructive,
    });
  }

  // Graceful browser fallback if DialogProvider is not yet mounted
  if (typeof window !== 'undefined' && window.confirm) {
    const text = message ? (title ? `${title}\n\n${message}` : message) : title;
    return Promise.resolve(window.confirm(text));
  }
  return Promise.resolve(false);
}

/**
 * Imperative alert dialog returning Promise<void>
 * Usage:
 *   await alertDialog('บันทึกข้อมูลเรียบร้อยแล้ว');
 *   // or
 *   await alertDialog({
 *     title: 'เกิดข้อผิดพลาด',
 *     message: 'ไม่สามารถติดต่อเซิร์ฟเวอร์ได้',
 *     confirmLabel: 'ตกลง',
 *     type: 'error', // 'info' | 'success' | 'warning' | 'error'
 *   });
 */
export function alertDialog(optionsOrMessage) {
  let opts = {};
  if (typeof optionsOrMessage === 'string') {
    opts = { message: optionsOrMessage };
  } else if (optionsOrMessage && typeof optionsOrMessage === 'object') {
    opts = { ...optionsOrMessage };
  }

  const {
    title = 'แจ้งเตือน',
    message = '',
    confirmLabel = 'ตกลง',
    type = 'info',
  } = opts;

  if (dialogHandler && dialogHandler.showAlert) {
    return dialogHandler.showAlert({
      title,
      message,
      confirmLabel,
      type,
    });
  }

  // Graceful browser fallback if DialogProvider is not yet mounted
  if (typeof window !== 'undefined' && window.alert) {
    const text = message ? (title ? `${title}\n\n${message}` : message) : title;
    window.alert(text);
  }
  return Promise.resolve();
}

/**
 * DialogProvider component to be placed in app/layout.js
 */
export function DialogProvider({ children }) {
  const [activeDialog, setActiveDialog] = useState(null);
  const confirmBtnRef = useRef(null);

  useEffect(() => {
    dialogHandler = {
      showConfirm: (opts) =>
        new Promise((resolve) => {
          setActiveDialog({ ...opts, isAlert: false, resolve });
        }),
      showAlert: (opts) =>
        new Promise((resolve) => {
          setActiveDialog({ ...opts, isAlert: true, resolve });
        }),
    };

    return () => {
      dialogHandler = null;
    };
  }, []);

  const closeDialog = useCallback(
    (result) => {
      if (!activeDialog) return;
      const { resolve, isAlert } = activeDialog;
      setActiveDialog(null);
      if (resolve) {
        resolve(isAlert ? undefined : Boolean(result));
      }
    },
    [activeDialog]
  );

  // Focus confirm button when opened
  useEffect(() => {
    if (activeDialog && confirmBtnRef.current) {
      confirmBtnRef.current.focus();
    }
  }, [activeDialog]);

  // Keyboard accessibility: Escape to cancel/close
  useEffect(() => {
    if (!activeDialog) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDialog(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeDialog, closeDialog]);

  // Determine dialog visual scheme
  let iconName = 'info';
  let iconColor = '#0284C7'; // Fleet blue
  let iconBg = '#E0F2FE';

  if (activeDialog) {
    if (activeDialog.destructive || activeDialog.type === 'error') {
      iconName = 'alert-triangle';
      iconColor = '#DC2626';
      iconBg = '#FEE2E2';
    } else if (activeDialog.type === 'warning') {
      iconName = 'alert-triangle';
      iconColor = '#D97706';
      iconBg = '#FEF3C7';
    } else if (activeDialog.type === 'success') {
      iconName = 'check-circle';
      iconColor = '#16A34A';
      iconBg = '#DCFCE7';
    } else {
      iconName = 'info';
      iconColor = '#0284C7';
      iconBg = '#E0F2FE';
    }
  }

  return (
    <>
      {children}
      {activeDialog && (
        <div
          className="dialog-backdrop"
          onClick={() => closeDialog(false)}
          aria-hidden="false"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            animation: 'dialogFadeIn 0.18s ease-out',
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            aria-describedby={activeDialog.message ? 'dialog-desc' : undefined}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: '430px',
              backgroundColor: '#FFFFFF',
              borderRadius: '20px',
              border: '1px solid #E2E8F0',
              boxShadow: '0 24px 60px rgba(15, 41, 66, 0.28), 0 4px 16px rgba(15, 23, 42, 0.08)',
              padding: '24px 22px 20px',
              animation: 'dialogScaleIn 0.22s cubic-bezier(0.22, 1, 0.36, 1)',
              color: '#0F172A',
              fontFamily: 'var(--font-sans), var(--font-thai), sans-serif',
            }}
          >
            {/* Header Icon + Title */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '14px' }}>
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '12px',
                  backgroundColor: iconBg,
                  color: iconColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <AppIcon name={iconName} size={22} strokeWidth={2.2} />
              </div>

              <div style={{ flex: 1, minWidth: 0, paddingTop: '2px' }}>
                <h2
                  id="dialog-title"
                  style={{
                    margin: 0,
                    fontSize: '17px',
                    fontWeight: 700,
                    color: '#0F2942',
                    lineHeight: 1.35,
                    letterSpacing: '-0.01em',
                  }}
                >
                  {activeDialog.title}
                </h2>
                {activeDialog.message && (
                  <p
                    id="dialog-desc"
                    style={{
                      margin: '6px 0 0',
                      fontSize: '13.5px',
                      color: '#475569',
                      lineHeight: 1.55,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {activeDialog.message}
                  </p>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: '10px',
                marginTop: '20px',
                paddingTop: '14px',
                borderTop: '1px solid #F1F5F9',
              }}
            >
              {!activeDialog.isAlert && (
                <button
                  type="button"
                  onClick={() => closeDialog(false)}
                  style={{
                    minHeight: '44px',
                    padding: '10px 18px',
                    borderRadius: '12px',
                    border: '1px solid #CBD5E1',
                    backgroundColor: '#F8FAFC',
                    color: '#475569',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    fontFamily: 'inherit',
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = '#F1F5F9';
                    e.currentTarget.style.borderColor = '#94A3B8';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = '#F8FAFC';
                    e.currentTarget.style.borderColor = '#CBD5E1';
                  }}
                >
                  {activeDialog.cancelLabel || 'ยกเลิก'}
                </button>
              )}

              <button
                ref={confirmBtnRef}
                type="button"
                onClick={() => closeDialog(true)}
                style={{
                  minHeight: '44px',
                  padding: '10px 22px',
                  borderRadius: '12px',
                  border: 'none',
                  backgroundColor: activeDialog.destructive
                    ? '#DC2626'
                    : '#0284C7',
                  color: '#FFFFFF',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: activeDialog.destructive
                    ? '0 4px 12px rgba(220, 38, 38, 0.28)'
                    : '0 4px 14px rgba(2, 132, 199, 0.28)',
                  transition: 'all 0.15s ease',
                  fontFamily: 'inherit',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = activeDialog.destructive
                    ? '#B91C1C'
                    : '#0369A1';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = activeDialog.destructive
                    ? '#DC2626'
                    : '#0284C7';
                }}
              >
                {activeDialog.confirmLabel || (activeDialog.isAlert ? 'ตกลง' : 'ยืนยัน')}
              </button>
            </div>
          </div>
        </div>
      )}
      <style jsx global>{`
        @keyframes dialogFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes dialogScaleIn {
          from { opacity: 0; transform: scale(0.95) translateY(6px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </>
  );
}

export default DialogProvider;
