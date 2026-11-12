'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { alertDialog } from '@/components/ui/ConfirmDialog';

export default function CandidateInterviewPage() {
  const { id } = useParams();

  // สถานะการโหลดและข้อมูล
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  // ขั้นตอนในหน้าสัมภาษณ์: 'welcome' | 'interviewing' | 'completed' | 'no_consent'
  const [stage, setStage] = useState('welcome');

  // ข้อมูลการสัมภาษณ์
  const [currentQIndex, setCurrentQIndex] = useState(0); // 0-based index ใน questions
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [manualText, setManualText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [micPermission, setMicPermission] = useState('prompt'); // 'prompt' | 'granted' | 'denied'

  const recognitionRef = useRef(null);
  const synthRef = useRef(null);

  // 1. โหลดข้อมูลรอบสัมภาษณ์
  useEffect(() => {
    if (!id) return;
    fetch(`/api/interview/${id}`)
      .then((r) => r.json())
      .then((res) => {
        if (!res.ok) {
          setError(res.error || 'ไม่พบรอบสัมภาษณ์');
          setLoading(false);
          return;
        }
        setData(res);
        if (res.session.status === 'completed') {
          setStage('completed');
        } else if (res.session.status === 'no_consent') {
          setStage('no_consent');
        } else if (res.session.status === 'in_progress') {
          // ถ้าเคยเริ่มไว้แล้ว ให้ดูว่าตอบไปถึงข้อไหน
          const applicantTurns = (res.turns || []).filter((t) => t.role === 'applicant' && t.question_ref > 0);
          const maxAnsweredRef = Math.max(0, ...applicantTurns.map((t) => t.question_ref));
          if (maxAnsweredRef >= (res.questionSet?.questions?.length || 0)) {
            setStage('completed');
          } else {
            setCurrentQIndex(maxAnsweredRef);
            setStage('welcome');
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        setError('เกิดข้อผิดพลาดในการเชื่อมต่อ: ' + err.message);
        setLoading(false);
      });
  }, [id]);

  // 2. เช็ค Web Speech API Support
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRec) {
        setSpeechSupported(false);
      }
      if ('speechSynthesis' in window) {
        synthRef.current = window.speechSynthesis;
      }
    }
  }, []);

  // ฟังก์ชันให้ AI พูดด้วยเสียงภาษาไทย
  const speakText = (text, onEnd) => {
    if (!synthRef.current) {
      if (onEnd) onEnd();
      return;
    }
    try {
      synthRef.current.cancel(); // หยุดเสียงเก่าก่อน
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'th-TH';
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      // ค้นหาเสียงไทยที่ดีที่สุดที่มีในเครื่องผู้ใช้
      const voices = synthRef.current.getVoices();
      const thaiVoice = voices.find((v) => v.lang.startsWith('th') || v.lang.includes('Thai'));
      if (thaiVoice) utterance.voice = thaiVoice;

      setIsAiSpeaking(true);
      utterance.onend = () => {
        setIsAiSpeaking(false);
        if (onEnd) onEnd();
      };
      utterance.onerror = () => {
        setIsAiSpeaking(false);
        if (onEnd) onEnd();
      };

      synthRef.current.speak(utterance);
    } catch {
      setIsAiSpeaking(false);
      if (onEnd) onEnd();
    }
  };

  // ฟังก์ชันหยุดพูด
  const stopSpeaking = () => {
    if (synthRef.current) {
      synthRef.current.cancel();
      setIsAiSpeaking(false);
    }
  };

  // ฟังก์ชันเริ่มฟังเสียงผู้สมัคร (Speech Recognition)
  const startListening = async () => {
    stopSpeaking();
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      await alertDialog({
        title: 'ไม่รองรับการฟังเสียงอัตโนมัติ',
        message: 'เบราว์เซอร์นี้ไม่รองรับการฟังเสียงอัตโนมัติ คุณสามารถพิมพ์ข้อความคำตอบลงในช่องด้านล่างได้ทันทีครับ',
        type: 'info',
      });
      return;
    }

    try {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { }
      }

      const recognition = new SpeechRec();
      recognition.lang = 'th-TH';
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onstart = () => {
        setIsListening(true);
        setMicPermission('granted');
      };

      recognition.onresult = (event) => {
        let interim = '';
        let final = '';
        for (let i = 0; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript + ' ';
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        const full = (final + interim).trim();
        setTranscript(full);
        setManualText(full);
      };

      recognition.onerror = async (e) => {
        console.warn('Speech recognition error:', e.error);
        if (e.error === 'not-allowed') {
          setMicPermission('denied');
          await alertDialog({
            title: 'การเข้าถึงไมโครโฟน',
            message: 'กรุณาอนุญาตการเข้าถึงไมโครโฟน หรือพิมพ์คำตอบในช่องข้อความได้เลยครับ',
            type: 'warning',
          });
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (e) {
      console.error(e);
      setIsListening(false);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch { }
      setIsListening(false);
    }
  };

  // 3. กดยินยอมและเริ่มการสัมภาษณ์
  const handleConsent = async (consent) => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/interview/${id}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'เกิดข้อผิดพลาด');

      if (!consent) {
        setStage('no_consent');
        return;
      }

      setStage('interviewing');
      setCurrentQIndex(0);

      // AI พูดข้อความเกริ่นนำ + คำถามแรก
      const firstQ = data.questionSet.questions[0];
      const introMsg = `${data.questionSet.intro_script || 'ยินดีต้อนรับครับ'} คำถามข้อที่ 1: ${firstQ?.q || ''}`;
      setTimeout(() => {
        speakText(introMsg);
      }, 500);
    } catch (e) {
      await alertDialog({ title: 'ข้อผิดพลาด', message: e.message, type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  // 4. บันทึกคำตอบและไปยังข้อถัดไป
  const handleSendAnswer = async () => {
    stopListening();
    stopSpeaking();

    const answer = (manualText || transcript).trim();
    if (!answer) {
      await alertDialog({
        title: 'กรุณาระบุคำตอบ',
        message: 'กรุณาพูดตอบหรือพิมพ์ข้อความคำตอบก่อนกดส่งครับ',
        type: 'warning',
      });
      return;
    }

    setSubmitting(true);
    const questions = data.questionSet.questions;
    const currentQ = questions[currentQIndex];

    try {
      // 1. ส่ง Turn ของคำถาม AI (ถ้ายังไม่เคยบันทึก)
      await fetch(`/api/interview/${id}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'ai',
          text: `คำถามข้อที่ ${currentQ.index}: ${currentQ.q}`,
          question_ref: currentQ.index,
        }),
      });

      // 2. ส่ง Turn ของคำตอบผู้สมัคร
      await fetch(`/api/interview/${id}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'applicant',
          text: answer,
          question_ref: currentQ.index,
        }),
      });

      // เคลียร์ค่าคำตอบ
      setTranscript('');
      setManualText('');

      const nextIndex = currentQIndex + 1;
      if (nextIndex < questions.length) {
        // มีข้อถัดไป
        setCurrentQIndex(nextIndex);
        const nextQ = questions[nextIndex];
        const nextPrompt = `คำถามข้อที่ ${nextQ.index}: ${nextQ.q}`;
        setTimeout(() => {
          speakText(nextPrompt);
        }, 500);
      } else {
        // ตอบครบทุกข้อแล้ว -> ปิดการสัมภาษณ์ & สั่ง AI ให้คะแนน
        setStage('completed');
        speakText('ขอบคุณมากครับสำหรับการสัมภาษณ์ ระบบได้บันทึกคำตอบและส่งให้ฝ่ายบุคคลเรียบร้อยแล้วครับ');
        await fetch(`/api/interview/${id}/complete`, { method: 'POST' });
      }
    } catch (e) {
      await alertDialog({
        title: 'บันทึกคำตอบล้มเหลว',
        message: 'เกิดข้อผิดพลาดในการบันทึกคำตอบ: ' + e.message,
        type: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  // ฟังคำถามปัจจุบันซ้ำ
  const handleRepeatQuestion = () => {
    stopListening();
    const questions = data?.questionSet?.questions || [];
    const currentQ = questions[currentQIndex];
    if (currentQ) {
      speakText(`คำถามข้อที่ ${currentQ.index}: ${currentQ.q}`);
    }
  };

  // Render ตามสถานะ
  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={styles.spinner}></div>
            <p style={{ marginTop: 16, color: '#64748b', fontSize: 16 }}>กำลังเชื่อมต่อระบบสัมภาษณ์ AI...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ textAlign: 'center', padding: '30px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
            <h3 style={{ color: '#0f172a', marginBottom: 8 }}>ไม่สามารถเข้าสู่ห้องสัมภาษณ์ได้</h3>
            <p style={{ color: '#64748b', fontSize: 14 }}>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const { applicant, questionSet } = data;
  const questions = questionSet?.questions || [];
  const currentQ = questions[currentQIndex];

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.logoBadge}>🤖 AI Interviewer</div>
        <div style={styles.headerSub}>ระบบสัมภาษณ์งานออนไลน์เบื้องต้น</div>
      </header>

      <main style={styles.main}>
        {/* ================= STAGE 1: WELCOME & CONSENT ================= */}
        {stage === 'welcome' && (
          <div style={styles.card}>
            <div style={styles.badgeRow}>
              <span style={styles.positionPill}>📌 ตำแหน่ง: {applicant.position}</span>
            </div>

            <h2 style={styles.title}>ยินดีต้อนรับ คุณ {applicant.name}</h2>
            <p style={styles.desc}>
              บริษัทขอเชิญท่านเข้ารับการสัมภาษณ์งานเบื้องต้นผ่านระบบปัญญาประดิษฐ์ (AI Voice Interview)
              เพื่อประเมินความพร้อมและประสบการณ์เบื้องต้น
            </p>

            <div style={styles.infoBox}>
              <div style={styles.infoRow}>
                <span style={styles.infoIcon}>⏱️</span>
                <div>
                  <div style={styles.infoTitle}>ระยะเวลาสั้นและสะดวก</div>
                  <div style={styles.infoDetail}>จำนวน {questions.length} คำถาม ใช้เวลาเพียง 3-5 นาที</div>
                </div>
              </div>
              <div style={styles.infoRow}>
                <span style={styles.infoIcon}>🎙️</span>
                <div>
                  <div style={styles.infoTitle}>ตอบด้วยเสียงหรือข้อความ</div>
                  <div style={styles.infoDetail}>สามารถกดปุ่มเพื่อพูด หรือพิมพ์ข้อความตอบในช่องได้ทันที</div>
                </div>
              </div>
              <div style={styles.infoRow}>
                <span style={styles.infoIcon}>🔒</span>
                <div>
                  <div style={styles.infoTitle}>การคุ้มครองข้อมูลส่วนบุคคล (PDPA)</div>
                  <div style={styles.infoDetail}>
                    {questionSet.consent_script ||
                      'การสนทนานี้จะถูกบันทึกเสียงและประมวลผลคำตอบเพื่อส่งให้ฝ่ายบุคคลพิจารณาประกอบการคัดเลือกเข้าทำงาน'}
                  </div>
                </div>
              </div>
            </div>

            <div style={styles.actionColumn}>
              <button
                style={{ ...styles.btnPrimary, opacity: submitting ? 0.7 : 1 }}
                onClick={() => handleConsent(true)}
                disabled={submitting}
              >
                {submitting ? 'กำลังเริ่มระบบ...' : '🎙️ ยินยอมและเริ่มสัมภาษณ์'}
              </button>
              <button
                style={styles.btnSecondary}
                onClick={() => handleConsent(false)}
                disabled={submitting}
              >
                ไม่สะดวกสัมภาษณ์ในขณะนี้
              </button>
            </div>
          </div>
        )}

        {/* ================= STAGE 2: INTERVIEWING ================= */}
        {stage === 'interviewing' && currentQ && (
          <div style={styles.card}>
            {/* Progress bar */}
            <div style={styles.progressContainer}>
              <div style={styles.progressHeader}>
                <span style={styles.progressText}>คำถามที่ {currentQIndex + 1} จาก {questions.length}</span>
                <span style={styles.progressPct}>{Math.round(((currentQIndex + 1) / questions.length) * 100)}%</span>
              </div>
              <div style={styles.progressBarBg}>
                <div
                  style={{
                    ...styles.progressBarFill,
                    width: `${((currentQIndex + 1) / questions.length) * 100}%`,
                  }}
                />
              </div>
            </div>

            {/* AI Voice Indicator */}
            <div style={styles.aiOrbContainer}>
              <div
                style={{
                  ...styles.aiOrb,
                  transform: isAiSpeaking ? 'scale(1.12)' : isListening ? 'scale(1.05)' : 'scale(1)',
                  boxShadow: isAiSpeaking
                    ? '0 0 28px rgba(59, 130, 246, 0.7)'
                    : isListening
                    ? '0 0 28px rgba(16, 185, 129, 0.7)'
                    : '0 0 14px rgba(148, 163, 184, 0.3)',
                  background: isAiSpeaking
                    ? 'linear-gradient(135deg, #3b82f6, #8b5cf6)'
                    : isListening
                    ? 'linear-gradient(135deg, #10b981, #06b6d4)'
                    : 'linear-gradient(135deg, #64748b, #94a3b8)',
                }}
              >
                <span style={{ fontSize: 32 }}>
                  {isAiSpeaking ? '🔊' : isListening ? '🎙️' : '🤖'}
                </span>
              </div>
              <div style={styles.aiStatusLabel}>
                {isAiSpeaking
                  ? 'AI กำลังพูดคำถาม...'
                  : isListening
                  ? 'กำลังฟังเสียงของคุณ (พูดได้เลย)...'
                  : 'พร้อมรับคำตอบ'}
              </div>
            </div>

            {/* Question Card */}
            <div style={styles.questionBox}>
              <div style={styles.questionTag}>คำถามข้อที่ {currentQIndex + 1}</div>
              <div style={styles.questionText}>{currentQ.q}</div>
              <div style={styles.questionActions}>
                <button
                  type="button"
                  style={styles.btnSmall}
                  onClick={handleRepeatQuestion}
                  disabled={isAiSpeaking}
                >
                  🔊 ฟังคำถามอีกครั้ง
                </button>
              </div>
            </div>

            {/* Candidate Answer Section */}
            <div style={styles.answerSection}>
              <div style={styles.answerHeader}>
                <span style={{ fontWeight: 600, fontSize: 14, color: '#334155' }}>คำตอบของคุณ:</span>
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  {isListening ? '🟢 กำลังบันทึกเสียง' : 'กดปุ่มไมค์เพื่อพูด หรือพิมพ์ข้อความ'}
                </span>
              </div>

              {/* Textarea for answer (speech writes here, can also type) */}
              <textarea
                style={styles.answerTextarea}
                rows={4}
                placeholder="คำตอบของคุณจะปรากฏที่นี่ขณะพูด หรือคุณสามารถพิมพ์ข้อความตอบได้โดยตรง..."
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
              />

              {/* Voice controls & Submit */}
              <div style={styles.controlsRow}>
                <button
                  type="button"
                  style={{
                    ...styles.micBtn,
                    backgroundColor: isListening ? '#ef4444' : '#2563eb',
                  }}
                  onClick={isListening ? stopListening : startListening}
                >
                  <span style={{ fontSize: 18, marginRight: 6 }}>{isListening ? '⏹️' : '🎙️'}</span>
                  {isListening ? 'หยุดฟังเสียง' : 'กดเพื่อพูดตอบ'}
                </button>

                <button
                  type="button"
                  style={{
                    ...styles.btnSubmitAnswer,
                    opacity: submitting || (!manualText.trim() && !transcript.trim()) ? 0.6 : 1,
                  }}
                  disabled={submitting || (!manualText.trim() && !transcript.trim())}
                  onClick={handleSendAnswer}
                >
                  {submitting
                    ? 'กำลังบันทึก...'
                    : currentQIndex + 1 === questions.length
                    ? 'ส่งคำตอบ & เสร็จสิ้น ✨'
                    : 'ส่งคำตอบ & ข้อถัดไป ➔'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= STAGE 3: COMPLETED ================= */}
        {stage === 'completed' && (
          <div style={styles.card}>
            <div style={{ textAlign: 'center', padding: '20px 10px' }}>
              <div style={styles.successIcon}>✅</div>
              <h2 style={styles.title}>การสัมภาษณ์เสร็จสมบูรณ์</h2>
              <p style={{ ...styles.desc, maxWidth: 440, margin: '10px auto' }}>
                ขอบคุณ <b>คุณ {applicant?.name}</b> สำหรับการสละเวลาในการสัมภาษณ์เบื้องต้น
              </p>

              <div style={styles.completeDetailBox}>
                <p style={{ margin: '0 0 8px', fontSize: 14, color: '#0f172a', fontWeight: 600 }}>
                  📋 ขั้นตอนต่อไป
                </p>
                <p style={{ margin: 0, fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
                  ระบบได้บันทึกคำตอบและจัดส่งบทสัมภาษณ์ให้ฝ่ายทรัพยากรบุคคล (HR) เป็นที่เรียบร้อยแล้ว
                  เจ้าหน้าที่จะติดต่อกลับผ่านทางเบอร์โทรศัพท์หรือช่องทางที่ท่านให้ไว้ครับ
                </p>
              </div>

              <div style={{ marginTop: 24, fontSize: 12, color: '#94a3b8' }}>
                ท่านสามารถปิดหน้านี้ได้ทันที
              </div>
            </div>
          </div>
        )}

        {/* ================= STAGE 4: NO CONSENT ================= */}
        {stage === 'no_consent' && (
          <div style={styles.card}>
            <div style={{ textAlign: 'center', padding: '30px 10px' }}>
              <div style={{ fontSize: 44, marginBottom: 12 }}>ℹ️</div>
              <h3 style={styles.title}>บันทึกข้อมูลเรียบร้อย</h3>
              <p style={{ ...styles.desc, maxWidth: 420, margin: '10px auto' }}>
                ระบบได้แจ้งฝ่ายบุคคลว่าท่านไม่สะดวกสัมภาษณ์ในขณะนี้ หากต้องการสัมภาษณ์ในภายหลัง
                กรุณาติดต่อเจ้าหน้าที่ฝ่ายบุคคลของบริษัทครับ
              </p>
            </div>
          </div>
        )}
      </main>

      <footer style={styles.footer}>
        <div>HR Pro Suite · AI Voice Candidate Screening System</div>
      </footer>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%)',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    color: '#0f172a',
    padding: '16px',
    boxSizing: 'border-box',
  },
  header: {
    textAlign: 'center',
    padding: '16px 0 12px',
  },
  logoBadge: {
    display: 'inline-block',
    background: '#1e293b',
    color: '#ffffff',
    padding: '6px 14px',
    borderRadius: '20px',
    fontSize: '14px',
    fontWeight: '700',
    letterSpacing: '0.3px',
  },
  headerSub: {
    fontSize: '12px',
    color: '#64748b',
    marginTop: '6px',
  },
  main: {
    flex: 1,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '8px 0 24px',
  },
  card: {
    width: '100%',
    maxWidth: '560px',
    background: '#ffffff',
    borderRadius: '20px',
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04)',
    padding: '24px 20px',
    boxSizing: 'border-box',
  },
  badgeRow: {
    marginBottom: '10px',
  },
  positionPill: {
    display: 'inline-block',
    background: '#e0f2fe',
    color: '#0369a1',
    padding: '4px 10px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: '600',
  },
  title: {
    margin: '0 0 10px',
    fontSize: '20px',
    fontWeight: '700',
    color: '#0f172a',
  },
  desc: {
    margin: '0 0 18px',
    fontSize: '14px',
    color: '#475569',
    lineHeight: '1.6',
  },
  infoBox: {
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '14px',
    padding: '14px',
    marginBottom: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  infoRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
  },
  infoIcon: {
    fontSize: '18px',
    lineHeight: '1.2',
  },
  infoTitle: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#1e293b',
  },
  infoDetail: {
    fontSize: '12px',
    color: '#64748b',
    marginTop: '2px',
    lineHeight: '1.5',
  },
  actionColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  btnPrimary: {
    width: '100%',
    padding: '14px',
    background: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: '12px',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  btnSecondary: {
    width: '100%',
    padding: '12px',
    background: 'transparent',
    color: '#64748b',
    border: '1px solid #cbd5e1',
    borderRadius: '12px',
    fontSize: '13px',
    cursor: 'pointer',
  },
  progressContainer: {
    marginBottom: '16px',
  },
  progressHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    color: '#64748b',
    fontWeight: '600',
    marginBottom: '6px',
  },
  progressText: {},
  progressPct: {
    color: '#2563eb',
  },
  progressBarBg: {
    height: '6px',
    background: '#e2e8f0',
    borderRadius: '3px',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #2563eb, #3b82f6)',
    borderRadius: '3px',
    transition: 'width 0.3s ease',
  },
  aiOrbContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    margin: '14px 0 18px',
  },
  aiOrb: {
    width: '72px',
    height: '72px',
    borderRadius: '50%',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    cursor: 'pointer',
  },
  aiStatusLabel: {
    marginTop: '10px',
    fontSize: '13px',
    fontWeight: '600',
    color: '#475569',
  },
  questionBox: {
    background: '#f0f9ff',
    border: '1px solid #bae6fd',
    borderRadius: '14px',
    padding: '14px',
    marginBottom: '16px',
  },
  questionTag: {
    fontSize: '11px',
    fontWeight: '700',
    color: '#0284c7',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '4px',
  },
  questionText: {
    fontSize: '15px',
    fontWeight: '600',
    color: '#0c4a6e',
    lineHeight: '1.6',
  },
  questionActions: {
    marginTop: '10px',
    display: 'flex',
    justifyContent: 'flex-end',
  },
  btnSmall: {
    background: '#ffffff',
    border: '1px solid #cbd5e1',
    borderRadius: '8px',
    padding: '6px 12px',
    fontSize: '12px',
    color: '#334155',
    cursor: 'pointer',
    fontWeight: '500',
  },
  answerSection: {
    background: '#ffffff',
  },
  answerHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '6px',
  },
  answerTextarea: {
    width: '100%',
    padding: '12px',
    fontSize: '14px',
    lineHeight: '1.5',
    color: '#0f172a',
    border: '1px solid #cbd5e1',
    borderRadius: '12px',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
    resize: 'vertical',
    outline: 'none',
  },
  controlsRow: {
    display: 'flex',
    gap: '10px',
    marginTop: '12px',
  },
  micBtn: {
    flex: '1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '12px',
    color: '#ffffff',
    border: 'none',
    borderRadius: '12px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background-color 0.15s ease',
  },
  btnSubmitAnswer: {
    flex: '1.4',
    padding: '12px',
    background: '#16a34a',
    color: '#ffffff',
    border: 'none',
    borderRadius: '12px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  successIcon: {
    fontSize: '56px',
    marginBottom: '12px',
  },
  completeDetailBox: {
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '14px',
    padding: '16px',
    textAlign: 'left',
    marginTop: '16px',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #e2e8f0',
    borderTop: '4px solid #2563eb',
    borderRadius: '50%',
    margin: '0 auto',
    animation: 'spin 1s linear infinite',
  },
  footer: {
    textAlign: 'center',
    fontSize: '11px',
    color: '#94a3b8',
    padding: '12px 0 6px',
  },
};
