import React, { useState, useEffect, useRef, useMemo, ChangeEvent } from 'react';
import Papa from 'papaparse';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { 
  QrCode, 
  Users, 
  Upload, 
  CheckCircle2, 
  XCircle, 
  Search, 
  Check, 
  X, 
  Ticket,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { Attendee, Tab } from './types';
import { cn } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import logo from './logo.png';

export default function App() {
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const attendeesRef = useRef<Attendee[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('scan');
  const [searchQuery, setSearchQuery] = useState('');
  const [lastScanResult, setLastScanResult] = useState<{
    success: boolean;
    message: string;
    attendee?: Attendee;
  } | null>(null);
  const [isScannerActive, setIsScannerActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const html5QrCodeRef = useRef<any>(null);
  const lastScannedRef = useRef<{ code: string; time: number } | null>(null);

  // Sync ref with state
  useEffect(() => {
    attendeesRef.current = attendees;
  }, [attendees]);

  // Load data from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('ticketboom_attendees');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setAttendees(parsed);
        attendeesRef.current = parsed;
      } catch (e) {
        console.error('Failed to parse saved attendees', e);
      }
    }
  }, []);

  // Save data to localStorage whenever it changes
  useEffect(() => {
    if (attendees.length > 0) {
      localStorage.setItem('ticketboom_attendees', JSON.stringify(attendees));
    }
  }, [attendees]);

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvError(null);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data as any[];
        
        if (data.length === 0) {
          setCsvError('El archivo CSV está vacío.');
          return;
        }

        // Check for required column
        if (!data[0].hasOwnProperty('Código QR')) {
          setCsvError('El archivo CSV no tiene la columna requerida "Código QR".');
          return;
        }

        const formattedData: Attendee[] = data.map((row) => ({
          Nombre: row.Nombre || '',
          Apellidos: row.Apellidos || '',
          'Correo electrónico': row['Correo electrónico'] || '',
          'Fecha de compra': row['Fecha de compra'] || '',
          'Tipo de entrada': row['Tipo de entrada'] || '',
          'Precio original': row['Precio original'] || '',
          'Gastos de gestion': row['Gastos de gestion'] || '',
          'Cupon usado': row['Cupon usado'] || '',
          'Codigo del cupon': row['Codigo del cupon'] || '',
          'Descuento aplicado': row['Descuento aplicado'] || '',
          'Precio pagado': row['Precio pagado'] || '',
          'Ticket ID': row['Ticket ID'] || '',
          'Código QR': row['Código QR'] || '',
          'Pregunta en Checkout': row['Pregunta en Checkout'] || '',
          'Respuesta en Checkout': row['Respuesta en Checkout'] || '',
          validated: false,
        }));
        setAttendees(formattedData);
        attendeesRef.current = formattedData;
        setLastScanResult(null);
      },
      error: (error) => {
        setCsvError('Error al procesar el archivo CSV: ' + error.message);
      }
    });
  };

  const validateTicket = (qrCode: string) => {
    const now = Date.now();
    
    // Cooldown logic: If the same code is scanned within 5 seconds, ignore it
    // This gives the user time to move the ticket away without triggering "already validated" error
    if (lastScannedRef.current && 
        lastScannedRef.current.code === qrCode && 
        now - lastScannedRef.current.time < 5000) {
      return;
    }

    // Use ref to get the most up-to-date state inside the scanner callback
    const currentAttendees = attendeesRef.current;
    const index = currentAttendees.findIndex(a => a['Código QR'] === qrCode);
    
    if (index === -1) {
      setLastScanResult({
        success: false,
        message: 'Código no encontrado'
      });
      // Don't set cooldown for errors so user can try again immediately if it was a misread
      return;
    }

    const attendee = currentAttendees[index];
    if (attendee.validated) {
      setLastScanResult({
        success: false,
        message: 'Entrada ya validada',
        attendee
      });
      lastScannedRef.current = { code: qrCode, time: now };
      return;
    }

    const updatedAttendees = [...currentAttendees];
    updatedAttendees[index] = {
      ...attendee,
      validated: true,
      validationTime: new Date().toLocaleTimeString()
    };
    
    setAttendees(updatedAttendees);
    setLastScanResult({
      success: true,
      message: 'Entrada validada correctamente',
      attendee: updatedAttendees[index]
    });

    // Set cooldown for successful validation
    lastScannedRef.current = { code: qrCode, time: now };

    // Clear result after 3 seconds
    setTimeout(() => {
      setLastScanResult(prev => {
        if (prev?.attendee?.['Código QR'] === qrCode) return null;
        return prev;
      });
    }, 3000);
  };

  const toggleManualValidation = (qrCode: string) => {
    setAttendees(prev => prev.map(a => {
      if (a['Código QR'] === qrCode) {
        return {
          ...a,
          validated: !a.validated,
          validationTime: !a.validated ? new Date().toLocaleTimeString() : undefined
        };
      }
      return a;
    }));
  };

  const resetData = () => {
    setAttendees([]);
    setLastScanResult(null);
    localStorage.removeItem('ticketboom_attendees');
  };

  useEffect(() => {
    let isMounted = true;
    let scannerInstance: any = null;

    const initScanner = async () => {
      if (activeTab === 'scan' && attendees.length > 0) {
        setCameraError(null);
        setIsScannerActive(false);
        
        // Wait for AnimatePresence and DOM rendering
        await new Promise(resolve => setTimeout(resolve, 400));
        if (!isMounted) return;

        const readerElement = document.getElementById("reader");
        if (!readerElement) {
          console.error("Reader element not found");
          return;
        }

        try {
          const { Html5Qrcode } = await import('html5-qrcode');
          scannerInstance = new Html5Qrcode("reader");
          
          const config = { 
            fps: 15, 
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0
          };

          // Try to get all cameras and find the main one (usually not wide/ultra-wide)
          const cameras = await Html5Qrcode.getCameras();
          let targetCameraId: any = { facingMode: "environment" };

          if (cameras && cameras.length > 0) {
            // Filter for back cameras (usually don't mention "front" or "selfie")
            const backCameras = cameras.filter(c => 
              !c.label.toLowerCase().includes('front') && 
              !c.label.toLowerCase().includes('selfie') &&
              !c.label.toLowerCase().includes('delantera')
            );

            if (backCameras.length > 0) {
              // Among back cameras, prefer one that doesn't mention "wide" or "ultra"
              const mainCamera = backCameras.find(c => 
                !c.label.toLowerCase().includes('wide') && 
                !c.label.toLowerCase().includes('ultra') &&
                !c.label.toLowerCase().includes('gran angular')
              );
              
              if (mainCamera) {
                targetCameraId = mainCamera.id;
              } else {
                // If all back cameras are wide, just take the first back camera
                targetCameraId = backCameras[0].id;
              }
            } else {
              // If no back cameras found by label, fallback to environment constraint
              targetCameraId = { facingMode: "environment" };
            }
          }

          await scannerInstance.start(
            targetCameraId, 
            config,
            (decodedText: string) => {
              validateTicket(decodedText);
            },
            () => {
              // Ignore scan failures
            }
          );
          
          if (isMounted) {
            html5QrCodeRef.current = scannerInstance;
            setIsScannerActive(true);
          } else {
            await scannerInstance.stop();
          }
        } catch (err: any) {
          console.error("Scanner start error:", err);
          if (isMounted) {
            setCameraError("No se pudo iniciar la cámara. Asegúrate de dar permisos y que no esté en uso por otra pestaña.");
            setIsScannerActive(false);
          }
        }
      }
    };

    initScanner();

    return () => {
      isMounted = false;
      const cleanup = async () => {
        if (scannerInstance) {
          try {
            if (scannerInstance.isScanning) {
              await scannerInstance.stop();
            }
          } catch (e) {
            console.error("Scanner cleanup error:", e);
          }
        }
        html5QrCodeRef.current = null;
      };
      cleanup();
    };
  }, [activeTab, attendees.length]);

  const filteredAttendees = useMemo(() => {
    return attendees.filter(a => {
      const fullName = `${a.Nombre} ${a.Apellidos}`.toLowerCase();
      return fullName.includes(searchQuery.toLowerCase());
    });
  }, [attendees, searchQuery]);

  const stats = useMemo(() => {
    const total = attendees.length;
    const validated = attendees.filter(a => a.validated).length;
    const percent = total > 0 ? Math.round((validated / total) * 100) : 0;
    return { total, validated, percent };
  }, [attendees]);

  if (attendees.length === 0) {
    return (
      <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center p-6 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center border border-neutral-100"
        >
          <div className="mb-8 flex justify-center">
            <div className="w-24 h-24 bg-blue-600 rounded-2xl flex items-center justify-center shadow-xl shadow-blue-100 overflow-hidden p-2">
              <img 
                src={logo} 
                alt="Ticketboom" 
                className="w-full h-full object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  const parent = e.currentTarget.parentElement;
                  if (parent) {
                    const icon = document.createElement('div');
                    icon.className = "flex flex-col items-center justify-center text-white font-bold text-xs";
                    icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-ticket mb-1"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="m9 12 2 2 4-4"/></svg><span>TICKETBOOM</span>';
                    parent.appendChild(icon);
                  }
                }}
              />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-neutral-900 mb-2">Validador de Entradas</h1>
          <p className="text-neutral-500 mb-8">Carga el fichero CSV de asistentes para empezar a validar entradas.</p>
          
          {csvError && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3 text-left"
            >
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <p className="text-sm text-red-800 font-medium">{csvError}</p>
            </motion.div>
          )}

          <label className="block">
            <span className="sr-only">Elegir CSV</span>
            <div className="relative group cursor-pointer">
              <input 
                type="file" 
                accept=".csv" 
                onChange={handleFileUpload}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 px-6 rounded-2xl transition-all shadow-lg shadow-blue-200 group-active:scale-95">
                <Upload className="w-5 h-5" />
                <span>Cargar Listado CSV</span>
              </div>
            </div>
          </label>
          
          <div className="mt-8 pt-8 border-t border-neutral-100">
            <p className="text-xs text-neutral-400 uppercase tracking-widest font-bold">Instrucciones</p>
            <ul className="text-sm text-neutral-500 text-left mt-4 space-y-2">
              <li className="flex gap-2"><Check className="w-4 h-4 text-green-500 shrink-0" /> El CSV debe tener la columna "Código QR".</li>
              <li className="flex gap-2"><Check className="w-4 h-4 text-green-500 shrink-0" /> Se recomienda usar en modo vertical.</li>
              <li className="flex gap-2"><Check className="w-4 h-4 text-green-500 shrink-0" /> Los datos se guardan localmente.</li>
            </ul>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col font-sans pb-24">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 px-4 py-2 sticky top-0 z-30">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-100 overflow-hidden p-1">
              <img 
                src={logo} 
                alt="TB" 
                className="w-full h-full object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  // If image fails, show icon
                  const parent = e.currentTarget.parentElement;
                  if (parent) {
                    const icon = document.createElement('div');
                    icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-ticket text-white w-5 h-5"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="m9 12 2 2 4-4"/></svg>';
                    parent.appendChild(icon.firstChild!);
                  }
                }}
              />
            </div>
            <div>
              <h1 className="font-bold text-neutral-900 leading-tight text-sm">Ticketboom</h1>
              <p className="text-[8px] text-neutral-500 font-bold uppercase tracking-widest">Validator</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={resetData}
              className="flex items-center gap-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 px-3 py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
              title="Cargar nuevo CSV"
            >
              <Upload className="w-4 h-4" />
              <span>Nuevo CSV</span>
            </button>
          </div>
        </div>
      </header>

      {/* Stats Bar */}
      <div className="bg-white border-b border-neutral-100 px-4 py-2">
        <div className="max-w-4xl mx-auto grid grid-cols-3 gap-2">
          <div className="bg-neutral-50 rounded-lg p-1.5 text-center border border-neutral-100">
            <p className="text-[8px] text-neutral-400 uppercase font-bold tracking-wider mb-0">Total</p>
            <p className="text-base font-bold text-neutral-900">{stats.total}</p>
          </div>
          <div className="bg-green-50 rounded-lg p-1.5 text-center border border-green-100">
            <p className="text-[8px] text-green-600 uppercase font-bold tracking-wider mb-0">Validadas</p>
            <p className="text-base font-bold text-green-700">{stats.validated}</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-1.5 text-center border border-blue-100">
            <p className="text-[8px] text-blue-600 uppercase font-bold tracking-wider mb-0">Progreso</p>
            <p className="text-base font-bold text-blue-700">{stats.percent}%</p>
          </div>
        </div>
        <div className="max-w-4xl mx-auto mt-1.5 h-1 bg-neutral-100 rounded-full overflow-hidden">
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${stats.percent}%` }}
            className="h-full bg-blue-600"
          />
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-3 md:p-6 overflow-hidden">
        <AnimatePresence mode="wait">
          {activeTab === 'scan' ? (
            <motion.div 
              key="scan"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="flex flex-col gap-3 h-full max-h-full"
            >
              <div className="relative bg-black rounded-2xl overflow-hidden aspect-square max-w-[280px] w-full mx-auto shadow-2xl border-2 border-white shrink-0">
                <div id="reader" className="w-full h-full"></div>
                {!isScannerActive && !cameraError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-neutral-900 text-white p-6 text-center">
                    <p>Iniciando cámara...</p>
                  </div>
                )}
                {cameraError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-900 text-white p-8 text-center">
                    <XCircle className="w-12 h-12 text-red-500 mb-4" />
                    <p className="font-bold text-lg mb-2">Error de Cámara</p>
                    <p className="text-sm text-neutral-400 mb-6">{cameraError}</p>
                    <div className="flex flex-col gap-3 w-full">
                      <button 
                        onClick={() => setActiveTab('list')}
                        className="bg-neutral-800 text-white px-6 py-3 rounded-2xl font-bold text-sm active:scale-95 transition-all"
                      >
                        Ir a Listado
                      </button>
                      <button 
                        onClick={() => window.location.reload()}
                        className="bg-white text-black px-6 py-3 rounded-2xl font-bold text-sm active:scale-95 transition-all"
                      >
                        Recargar Aplicación
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Scan Result Area */}
              <div className="flex-1 flex items-center justify-center min-h-[100px]">
                <AnimatePresence mode="wait">
                  {lastScanResult ? (
                    <motion.div 
                      key="result"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className={cn(
                        "w-full rounded-2xl p-4 shadow-lg border-2 flex items-center gap-3",
                        lastScanResult.success 
                          ? "bg-green-50 border-green-200 text-green-800" 
                          : "bg-red-50 border-red-200 text-red-800"
                      )}
                    >
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                        lastScanResult.success ? "bg-green-200" : "bg-red-200"
                      )}>
                        {lastScanResult.success ? <CheckCircle2 className="w-6 h-6" /> : <XCircle className="w-6 h-6" />}
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <h3 className="font-bold text-base truncate">{lastScanResult.message}</h3>
                        {lastScanResult.attendee && (
                          <p className="text-xs opacity-90 font-medium truncate">
                            {lastScanResult.attendee.Nombre} {lastScanResult.attendee.Apellidos}
                          </p>
                        )}
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="placeholder"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="text-center text-neutral-400"
                    >
                      <QrCode className="w-8 h-8 mx-auto mb-2 opacity-20" />
                      <p className="text-xs font-medium">Esperando escaneo...</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="list"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-3 h-full flex flex-col"
            >
              <div className="relative shrink-0">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400" />
                <input 
                  type="text"
                  placeholder="Buscar por nombre o apellidos..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-white border border-neutral-200 rounded-2xl py-3 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm transition-all text-sm"
                />
              </div>

              <div className="flex-1 overflow-y-auto -mx-3 px-3 pb-20">
                <div className="space-y-3">
                  {filteredAttendees.length > 0 ? (
                    filteredAttendees.map((attendee) => (
                    <div 
                      key={attendee['Código QR']}
                      className={cn(
                        "bg-white border rounded-2xl p-4 flex items-center justify-between transition-all",
                        attendee.validated ? "border-green-100 bg-green-50/30" : "border-neutral-100"
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-neutral-900 truncate">
                          {attendee.Nombre} {attendee.Apellidos}
                        </h3>
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-xs text-neutral-500 truncate">{attendee['Tipo de entrada']}</p>
                          {attendee.validated && (
                            <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-bold uppercase">
                              {attendee.validationTime}
                            </span>
                          )}
                        </div>
                      </div>
                      <button 
                        onClick={() => toggleManualValidation(attendee['Código QR'])}
                        className={cn(
                          "w-12 h-12 rounded-xl flex items-center justify-center transition-all active:scale-90",
                          attendee.validated 
                            ? "bg-green-600 text-white shadow-lg shadow-green-100" 
                            : "bg-neutral-100 text-neutral-400 hover:bg-neutral-200"
                        )}
                      >
                        {attendee.validated ? <Check className="w-6 h-6" /> : <Users className="w-5 h-5" />}
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-12 bg-white rounded-3xl border border-dashed border-neutral-200">
                    <Users className="w-12 h-12 text-neutral-200 mx-auto mb-4" />
                    <p className="text-neutral-500 font-medium">No se encontraron asistentes</p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
        </AnimatePresence>
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-neutral-200 px-6 py-4 z-40 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
        <div className="max-w-md mx-auto flex items-center justify-around gap-4">
          <button 
            onClick={() => setActiveTab('scan')}
            className={cn(
              "flex flex-col items-center gap-1 flex-1 py-2 rounded-2xl transition-all",
              activeTab === 'scan' ? "text-blue-600 bg-blue-50" : "text-neutral-400 hover:text-neutral-600"
            )}
          >
            <QrCode className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Escanear</span>
          </button>
          <button 
            onClick={() => setActiveTab('list')}
            className={cn(
              "flex flex-col items-center gap-1 flex-1 py-2 rounded-2xl transition-all",
              activeTab === 'list' ? "text-blue-600 bg-blue-50" : "text-neutral-400 hover:text-neutral-600"
            )}
          >
            <Users className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Asistentes</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
