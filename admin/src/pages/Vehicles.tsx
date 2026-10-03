import { useState, useRef } from 'react';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore';
import { supabaseEnabled } from '../lib/supabase';
import { uploadVehicleImage, deleteVehicleImage } from '../lib/vehicleImages';
import { toast } from '../store/useToast';
import Header from '../components/layout/Header';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';
import CropModal from '../components/ui/CropModal';
import VehicleImageFields, { ImageSlot, SLOT_ASPECT } from '../components/ui/VehicleImageFields';
import VehicleReviews from '../components/ui/VehicleReviews';
import Select from '../components/ui/Select';
import DateInput from '../components/ui/DateInput';
import { Plus, Car, Pencil, Trash2, Shield, CalendarDays, Wrench, TrendingUp, Hash, Camera, Upload, X, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { Vehicle, VehicleStatus } from '../types';
import { isInsuranceComplete, clearInsuranceReminder } from '../lib/insuranceReminder';
import { vehicleNetRevenue } from '../lib/revenue';

const STATUS_OPTIONS: VehicleStatus[] = ['Available', 'Reserved', 'Ongoing', 'Maintenance'];
const FUEL_TYPES    = ['Petrol', 'Diesel', 'Hybrid', 'Electric', 'CNG'];
const TRANSMISSIONS = ['Manual', 'Automatic', 'CVT', 'Semi-Automatic'];

const empty = (): Omit<Vehicle, 'id' | 'createdAt' | 'revenue' | 'rentCount'> => ({
  vehicleNumber: '',
  brand: '',
  model: '',
  year: new Date().getFullYear(),
  ownerId: '',
  dailyRent: 0,
  extraKmRate: 50,
  includedKmPerDay: 100,
  status: 'Available',
  color: '',
  seats: 5,
  fuelType: 'Petrol',
  transmission: 'Manual',
  mileage: 0,
  insurance: { provider: '', policyNumber: '', expiryDate: '', premium: 0 },
});

export default function Vehicles() {
  const { vehicles, owners, bookings, expenses, addVehicle, updateVehicle, deleteVehicle } = useStore();
  const { currentUser, can, isAdmin } = useAuthStore();

  const [filter,   setFilter]   = useState<VehicleStatus | 'All'>('All');
  const [modal,    setModal]    = useState<'add' | 'edit' | 'view' | null>(null);
  const [selected, setSelected] = useState<Vehicle | null>(null);
  const [form,     setForm]     = useState(empty());
  const [uploading,       setUploading]       = useState(false);
  const [savedUrls,       setSavedUrls]       = useState<string[]>([]);
  const [pendingFiles,    setPendingFiles]    = useState<File[]>([]);
  const [pendingPreviews, setPendingPreviews] = useState<string[]>([]);
  const [galleryIndex,    setGalleryIndex]    = useState(0);
  const [uploadingFor,    setUploadingFor]    = useState<string | null>(null);
  const [cropFile,        setCropFile]        = useState<File | null>(null);
  const [cropSrc,         setCropSrc]         = useState<string | null>(null);
  // Admin image (cut-out) and hero image: one each — saved URL plus an optional new file
  const [adminSaved,      setAdminSaved]      = useState<string | null>(null);
  const [adminPending,    setAdminPending]    = useState<{ file: File; preview: string } | null>(null);
  const [heroSaved,       setHeroSaved]       = useState<string | null>(null);
  const [heroPending,     setHeroPending]     = useState<{ file: File; preview: string } | null>(null);
  const [cropSlot,        setCropSlot]        = useState<ImageSlot>('photos');
  const cardFileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef  = useRef<string | null>(null);
  const cropQueueRef     = useRef<File[]>([]);
  const cropSlotRef      = useRef<ImageSlot>('photos');

  const isOwnerRole = !isAdmin() && currentUser?.role === 'owner';
  const canActOn    = (v: Vehicle) => isAdmin() || v.ownerId === currentUser?.ownerId;

  const filtered = filter === 'All' ? vehicles : vehicles.filter((v) => v.status === filter);

  // For owner role: split into mine vs others
  const myFiltered     = isOwnerRole ? filtered.filter((v) => v.ownerId === currentUser?.ownerId) : filtered;
  const othersFiltered = isOwnerRole ? filtered.filter((v) => v.ownerId !== currentUser?.ownerId) : [];

  // savedUrls / pendingFiles / pendingPreviews hold the VEHICLE PHOTOS gallery
  const resetImageState = (v?: Vehicle) => {
    setSavedUrls(v?.photoUrls ?? []);
    setPendingFiles([]);
    setPendingPreviews([]);
    setAdminSaved(v?.imageUrl ?? null);
    setAdminPending(null);
    setHeroSaved(v?.heroImageUrl ?? null);
    setHeroPending(null);
    setGalleryIndex(0);
  };

  const openAdd = () => { setForm(empty()); resetImageState(); setModal('add'); };
  const openEdit = (v: Vehicle) => {
    setSelected(v);
    setForm({ ...v });
    resetImageState(v);
    setModal('edit');
  };
  const openView = (v: Vehicle, allowView = true) => {
    if (!allowView) return;
    setSelected(v);
    setGalleryIndex(0);
    setModal('view');
  };

  const addFileToPending = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => setPendingPreviews((prev) => [...prev, e.target!.result as string]);
    reader.readAsDataURL(file);
    setPendingFiles((prev) => [...prev, file]);
  };

  const startCropFor = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => { setCropFile(file); setCropSrc(e.target!.result as string); };
    reader.readAsDataURL(file);
  };

  const advanceCropQueue = () => {
    if (cropQueueRef.current.length === 0) { setCropFile(null); setCropSrc(null); return; }
    const [next, ...rest] = cropQueueRef.current;
    cropQueueRef.current = rest;
    startCropFor(next);
  };

  // A cropped (or uncropped) file goes to whichever image kind is being edited
  const acceptFile = (file: File) => {
    const slot = cropSlotRef.current;
    if (slot === 'photos') { addFileToPending(file); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      const next = { file, preview: e.target!.result as string };
      if (slot === 'admin') setAdminPending(next); else setHeroPending(next);
    };
    reader.readAsDataURL(file);
  };
  const handleCropSave = (croppedFile: File) => { acceptFile(croppedFile); advanceCropQueue(); };
  const handleCropSkip = () => { if (cropFile) acceptFile(cropFile); advanceCropQueue(); };

  const handleFileSelect = (slot: ImageSlot, files: FileList | null) => {
    if (!files) return;
    const accepted = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!accepted.length) return;
    cropSlotRef.current = slot;
    setCropSlot(slot);
    // Admin and hero take a single image; vehicle photos can be several
    cropQueueRef.current = slot === 'photos' ? accepted.slice(1) : [];
    startCropFor(accepted[0]);
  };

  const clearSingle = (slot: 'admin' | 'hero') => {
    if (slot === 'admin') { setAdminSaved(null); setAdminPending(null); }
    else { setHeroSaved(null); setHeroPending(null); }
  };

  const removeSavedUrl = (url: string) => setSavedUrls((prev) => prev.filter((u) => u !== url));
  const removePending  = (idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
    setPendingPreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  const triggerCardUpload = (vehicleId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    uploadTargetRef.current = vehicleId;
    cardFileInputRef.current?.click();
  };

  const handleCardFileSelect = async (files: FileList | null) => {
    const vehicleId = uploadTargetRef.current;
    if (!files || !vehicleId || !supabaseEnabled) return;
    const file = files[0];
    if (!file || !file.type.startsWith('image/')) return;
    setUploadingFor(vehicleId);
    try {
      // The camera button on a card sets the ADMIN image (the cut-out shown on that card)
      const url = await uploadVehicleImage(vehicleId, file);
      const old = vehicles.find((x) => x.id === vehicleId)?.imageUrl;
      updateVehicle(vehicleId, { imageUrl: url, imageUrls: [url] });
      if (old && old !== url) deleteVehicleImage(old);
    } catch (err) {
      console.error('Card image upload failed:', err);
      toast.error('Upload failed', (err as { message?: string })?.message ?? 'Could not upload the image. Make sure the "vehicle-images" storage bucket exists and is set to Public in Supabase.');
    } finally {
      setUploadingFor(null);
      uploadTargetRef.current = null;
      if (cardFileInputRef.current) cardFileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    setUploading(true);
    try {
      let vehicleId: string;
      if (modal === 'add') {
        vehicleId = addVehicle(form);
      } else {
        vehicleId = selected!.id;
      }

      const upload = async (file: File): Promise<string | null> => {
        if (!supabaseEnabled) return null;
        try {
          return await uploadVehicleImage(vehicleId, file);
        } catch (err) {
          console.error('Image upload failed:', err);
          toast.error('Upload failed', (err as { message?: string })?.message ?? 'Could not upload image. Make sure the "vehicle-images" storage bucket exists and is set to Public in Supabase.');
          return null;
        }
      };

      // Upload new files for each image kind
      const adminUrl = adminPending ? (await upload(adminPending.file)) ?? adminSaved : adminSaved;
      const heroUrl  = heroPending  ? (await upload(heroPending.file))  ?? heroSaved  : heroSaved;
      const uploadedPhotos: string[] = [];
      for (const file of pendingFiles) {
        const url = await upload(file);
        if (url) uploadedPhotos.push(url);
      }
      const photoUrls = [...savedUrls, ...uploadedPhotos];

      // Only send image fields that changed, so vehicles without the new
      // hero/photo columns (migration not run yet) can still be edited.
      const orig = modal === 'edit' ? selected : null;
      const imageUpdates: Partial<Vehicle> = {};
      if (adminUrl !== (orig?.imageUrl ?? null)) {
        imageUpdates.imageUrl = adminUrl ?? undefined;
        imageUpdates.imageUrls = adminUrl ? [adminUrl] : [];
      }
      if (heroUrl !== (orig?.heroImageUrl ?? null)) imageUpdates.heroImageUrl = heroUrl ?? undefined;
      if (JSON.stringify(photoUrls) !== JSON.stringify(orig?.photoUrls ?? [])) imageUpdates.photoUrls = photoUrls;

      // Delete replaced/removed files from storage (best-effort)
      if (orig) {
        if (orig.imageUrl && orig.imageUrl !== adminUrl) deleteVehicleImage(orig.imageUrl);
        if (orig.heroImageUrl && orig.heroImageUrl !== heroUrl) deleteVehicleImage(orig.heroImageUrl);
        (orig.photoUrls ?? []).filter((u) => !photoUrls.includes(u)).forEach(deleteVehicleImage);
      }

      if (modal === 'edit') {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { imageUrl, imageUrls, heroImageUrl, photoUrls: _p, ...details } = form as Vehicle;
        // Only send the spec fields if they changed (keeps edits working before website.sql adds them)
        if (details.fuelEfficiency === (selected?.fuelEfficiency ?? undefined)) delete details.fuelEfficiency;
        if (details.tankCapacity === (selected?.tankCapacity ?? undefined)) delete details.tankCapacity;
        updateVehicle(vehicleId, { ...details, ...imageUpdates });
      } else if (Object.keys(imageUpdates).length > 0) {
        updateVehicle(vehicleId, imageUpdates);
      }

      // Clear the weekly reminder gate if insurance is now complete so no
      // further SMS/notifications fire for this vehicle until it lapses again.
      if (isInsuranceComplete(form)) {
        clearInsuranceReminder(vehicleId);
      }
    } finally {
      setUploading(false);
      setModal(null);
    }
  };

  const handleDelete = (id: string) => {
    if (confirm('Delete this vehicle?')) deleteVehicle(id);
  };

  const set    = (field: string, value: unknown) => setForm((f) => ({ ...f, [field]: value }));
  const setIns = (field: string, value: unknown) =>
    setForm((f) => ({ ...f, insurance: { ...f.insurance, [field]: value } }));

  const renderCard = (v: Vehicle, clickable = true) => {
    const owner         = owners.find((o) => o.id === v.ownerId);
    const activeBooking = bookings.find((b) => b.vehicleId === v.id && (b.status === 'Confirmed' || b.status === 'Ongoing'));
    const mainExp       = expenses.find((e) => e.vehicleId === v.id);
    const mine          = canActOn(v);

    return (
      <div
        key={v.id}
        className={`card transition-shadow ${clickable ? 'hover:shadow-card-hover cursor-pointer' : 'cursor-default opacity-80'}`}
        onClick={() => clickable && openView(v)}
      >
        {/* Vehicle image */}
        {v.imageUrl ? (
          /*
           * clip-path allows the car to overflow 28 px above the platform (pop-out)
           * while keeping sides and bottom clipped to the rounded platform edge.
           */
          <div
            className="relative mb-3 group/img"
            style={{ clipPath: 'inset(-28px 0 0 0 round 0 0 16px 16px)' }}
          >
            {/* Recessed platform */}
            <div
              className="h-24 rounded-2xl"
              style={{
                background: 'linear-gradient(180deg,#D6D6DB 0%,#E2E2E6 50%,#ECECEF 100%)',
                boxShadow:
                  'inset 0 6px 18px rgba(17,17,20,0.20),' +
                  'inset 0 -3px 8px rgba(255,255,255,0.28),' +
                  'inset 3px 0 10px rgba(17,17,20,0.08),' +
                  'inset -3px 0 10px rgba(17,17,20,0.08)',
              }}
            />
            {/* Car — anchored to platform floor, rises above it */}
            <img
              src={v.imageUrl}
              alt={`${v.brand} ${v.model}`}
              className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full pointer-events-none select-none"
              style={{
                maxHeight: 148,
                objectFit: 'contain',
                objectPosition: 'center bottom',
                filter: 'drop-shadow(0 8px 14px rgba(15,25,70,0.24)) drop-shadow(0 2px 5px rgba(0,0,0,0.12))',
              }}
            />
            {/* Badges */}
            <div className="absolute top-2 right-2 z-10"><StatusBadge status={v.status} /></div>
            {!mine && (
              <div className="absolute top-2 left-2 z-10">
                <span className="text-[10px] bg-navy-700/70 text-white px-2 py-0.5 rounded-full">View only</span>
              </div>
            )}
            {mine && can('canEditVehicle') && supabaseEnabled && (
              <button
                type="button"
                onClick={(e) => triggerCardUpload(v.id, e)}
                className="absolute bottom-2 right-2 z-10 w-7 h-7 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity"
                title="Change photo"
              >
                {uploadingFor === v.id
                  ? <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  : <Camera size={12} />}
              </button>
            )}
          </div>
        ) : (
          /* No photo yet — upload placeholder */
          <div
            className={`w-full h-32 rounded-2xl mb-3 relative flex flex-col items-center justify-center gap-1.5
              bg-gradient-to-b from-navy-50/80 to-navy-100/50 ring-1 ring-dashed ring-navy-200
              ${mine && can('canEditVehicle') && supabaseEnabled ? 'cursor-pointer hover:bg-navy-100/60 hover:ring-navy-300 transition-colors' : ''}`}
            onClick={(e) => { if (mine && can('canEditVehicle') && supabaseEnabled) triggerCardUpload(v.id, e); }}
          >
            <div className="absolute top-2 right-2 z-10"><StatusBadge status={v.status} /></div>
            {!mine && (
              <div className="absolute top-2 left-2 z-10">
                <span className="text-[10px] bg-navy-700/70 text-white px-2 py-0.5 rounded-full">View only</span>
              </div>
            )}
            {uploadingFor === v.id ? (
              <span className="w-6 h-6 border-2 border-navy-300 border-t-navy-600 rounded-full animate-spin" />
            ) : mine && can('canEditVehicle') && supabaseEnabled ? (
              <>
                <div className="w-9 h-9 rounded-full bg-navy-100 flex items-center justify-center">
                  <Camera size={16} className="text-navy-400" />
                </div>
                <p className="text-[11px] text-navy-400 font-medium">Add Photo</p>
              </>
            ) : (
              <Car size={28} className="text-navy-200" />
            )}
          </div>
        )}

        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-navy-50 flex items-center justify-center flex-shrink-0">
              <Car size={16} className="text-navy-600" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-navy-800 truncate">{v.brand} {v.model}</p>
              <p className="text-xs text-navy-400">{v.vehicleNumber} · {v.year}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-y-2 text-xs mb-3">
          <div>
            <p className="text-navy-400">Owner</p>
            <p className="font-medium text-navy-700">{owner?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-navy-400">Daily Rent</p>
            <p className="font-medium text-navy-700">Rs {v.dailyRent.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-navy-400">Fuel</p>
            <p className="font-medium text-navy-700">{v.fuelType ?? '—'}</p>
          </div>
          <div>
            <p className="text-navy-400">Transmission</p>
            <p className="font-medium text-navy-700">{v.transmission ?? '—'}</p>
          </div>
        </div>

        {/* Status context strips */}
        {v.status === 'Reserved' && activeBooking && (
          <div className="flex items-center gap-2 bg-blue-50 rounded-xl px-3 py-2 mb-3">
            <CalendarDays size={13} className="text-blue-600 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-blue-700 truncate">{activeBooking.customerName}</p>
              <p className="text-[10px] text-blue-500">{activeBooking.startDate} → {activeBooking.endDate}</p>
            </div>
          </div>
        )}
        {v.status === 'Ongoing' && activeBooking && (
          <div className="flex items-center gap-2 bg-emerald-50 rounded-xl px-3 py-2 mb-3">
            <TrendingUp size={13} className="text-emerald-600 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-emerald-700 truncate">{activeBooking.customerName}</p>
              <p className="text-[10px] text-emerald-500">Ongoing since {activeBooking.startDate}</p>
            </div>
          </div>
        )}
        {v.status === 'Maintenance' && mainExp && (
          <div className="flex items-center gap-2 bg-red-50 rounded-xl px-3 py-2 mb-3">
            <Wrench size={13} className="text-red-500 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-red-600 truncate">{mainExp.category} — {mainExp.description}</p>
              <p className="text-[10px] text-red-400">{mainExp.date}</p>
            </div>
          </div>
        )}

        {/* Insurance incomplete warning — shown to owners/admins who can act on this vehicle */}
        {mine && !isInsuranceComplete(v) && (
          <div className="flex items-center gap-1.5 text-[11px] text-orange-600 bg-orange-50 rounded-lg px-2.5 py-1.5 mb-3">
            <AlertTriangle size={10} className="flex-shrink-0" />
            Insurance details incomplete
          </div>
        )}

        {/* Footer: revenue + actions */}
        <div className="flex items-center justify-between border-t border-navy-50 pt-3">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-xs text-navy-400">Revenue</p>
              <p className="text-sm font-bold text-navy-700">Rs {vehicleNetRevenue(v, bookings).toLocaleString()}</p>
            </div>
            <div className="flex items-center gap-1 text-navy-400">
              <Hash size={11} />
              <span className="text-xs font-semibold text-navy-500">{v.rentCount ?? 0} rentals</span>
            </div>
          </div>
          {mine && (
            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
              {can('canEditVehicle') && (
                <button
                  onClick={() => openEdit(v)}
                  className="w-8 h-8 rounded-lg hover:bg-navy-50 flex items-center justify-center text-navy-400 hover:text-navy-700 transition-colors"
                >
                  <Pencil size={14} />
                </button>
              )}
              {isAdmin() && (
                <button
                  onClick={() => handleDelete(v.id)}
                  className="w-8 h-8 rounded-lg hover:bg-red-50 flex items-center justify-center text-navy-400 hover:text-red-600 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const SectionLabel = ({ children, count }: { children: string; count: number }) => (
    <div className="flex items-center gap-3 mb-4 mt-2">
      <p className="text-xs font-semibold text-navy-500 uppercase tracking-widest">{children}</p>
      <span className="text-xs bg-navy-100 text-navy-500 px-2 py-0.5 rounded-full font-medium">{count}</span>
      <div className="flex-1 h-px bg-navy-100" />
    </div>
  );

  return (
    <div>
      {/* Hidden file input for card quick-upload */}
      <input
        ref={cardFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleCardFileSelect(e.target.files)}
      />

      <Header title="Vehicles" subtitle={`${vehicles.length} vehicles in your fleet`} />

      {/* Filter tabs + Add */}
      <div className="flex items-center justify-between mb-5 gap-3">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {(['All', ...STATUS_OPTIONS] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors flex-shrink-0 ${
                filter === s ? 'bg-navy-700 text-white' : 'bg-white text-navy-500 hover:bg-navy-50 shadow-card'
              }`}
            >
              {s}
              {s !== 'All' && (
                <span className="ml-1.5 opacity-70">{vehicles.filter((v) => v.status === s).length}</span>
              )}
            </button>
          ))}
        </div>
        {(isAdmin() || can('canEditVehicle')) && (
          <button onClick={openAdd} className="btn-primary flex items-center gap-2 flex-shrink-0">
            <Plus size={15} /> Add Vehicle
          </button>
        )}
      </div>

      {/* Grid — owner sees own vehicles first, then others */}
      {isOwnerRole ? (
        <>
          <SectionLabel count={myFiltered.length}>My Vehicles</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
            {myFiltered.length > 0
              ? myFiltered.map((v) => renderCard(v, true))
              : <div className="col-span-3 text-center py-10 text-navy-400 text-sm">No vehicles under your ownership.</div>
            }
          </div>

          {othersFiltered.length > 0 && (
            <>
              <SectionLabel count={othersFiltered.length}>Other Fleet Vehicles</SectionLabel>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {othersFiltered.map((v) => renderCard(v, false))}
              </div>
            </>
          )}
        </>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((v) => renderCard(v, true))}
          {filtered.length === 0 && (
            <div className="col-span-3 text-center py-16 text-navy-400 text-sm">No vehicles found.</div>
          )}
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal
        open={modal === 'add' || modal === 'edit'}
        onClose={() => setModal(null)}
        title={modal === 'add' ? 'Add New Vehicle' : 'Edit Vehicle'}
        width="max-w-2xl"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Vehicle Number">
            <input className="input" value={form.vehicleNumber} onChange={(e) => set('vehicleNumber', e.target.value)} placeholder="CAB-1234" />
          </Field>
          <Field label="Brand">
            <input className="input" value={form.brand} onChange={(e) => set('brand', e.target.value)} placeholder="Toyota" />
          </Field>
          <Field label="Model">
            <input className="input" value={form.model} onChange={(e) => set('model', e.target.value)} placeholder="Prius" />
          </Field>
          <Field label="Year">
            <input className="input" type="number" value={form.year} onChange={(e) => set('year', +e.target.value)} />
          </Field>
          <Field label="Owner">
            <Select value={form.ownerId} onChange={(v) => set('ownerId', v)} placeholder="Select owner" nullable
              options={owners.map((o) => ({ value: o.id, label: o.name }))} />
          </Field>
          <Field label="Daily Rent (Rs)">
            <input className="input" type="number" value={form.dailyRent} onChange={(e) => set('dailyRent', +e.target.value)} />
          </Field>
          <Field label="Included km / day">
            <input className="input" type="number" value={form.includedKmPerDay ?? 100} onChange={(e) => set('includedKmPerDay', +e.target.value)} placeholder="100" />
          </Field>
          <Field label="Extra km rate (Rs/km)">
            <input className="input" type="number" value={form.extraKmRate ?? 50} onChange={(e) => set('extraKmRate', +e.target.value)} placeholder="50" />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(v) => set('status', v as VehicleStatus)}
              options={STATUS_OPTIONS.map((s) => ({ value: s, label: s }))} />
          </Field>
          <Field label="Color">
            <input className="input" value={form.color ?? ''} onChange={(e) => set('color', e.target.value)} placeholder="Silver" />
          </Field>
          <Field label="Fuel Type">
            <Select value={form.fuelType ?? ''} onChange={(v) => set('fuelType', v)}
              options={FUEL_TYPES.map((f) => ({ value: f, label: f }))} />
          </Field>
          <Field label="Transmission">
            <Select value={form.transmission ?? ''} onChange={(v) => set('transmission', v)}
              options={TRANSMISSIONS.map((t) => ({ value: t, label: t }))} />
          </Field>
          <Field label="Seats">
            <input className="input" type="number" value={form.seats ?? 5} onChange={(e) => set('seats', +e.target.value)} />
          </Field>
          <Field label="Mileage (km)">
            <input className="input" type="number" value={form.mileage ?? 0} onChange={(e) => set('mileage', +e.target.value)} />
          </Field>
          <Field label="Fuel efficiency (km/L)">
            <input className="input" type="number" step="0.1" min="0" placeholder="e.g. 18"
                   value={form.fuelEfficiency ?? ''}
                   onChange={(e) => set('fuelEfficiency', e.target.value === '' ? null : +e.target.value)} />
          </Field>
          <Field label="Fuel tank (litres)">
            <input className="input" type="number" step="0.1" min="0" placeholder="e.g. 36"
                   value={form.tankCapacity ?? ''}
                   onChange={(e) => set('tankCapacity', e.target.value === '' ? null : +e.target.value)} />
          </Field>

          {/* ── Vehicle Images: admin cut-out, website hero, real photos ── */}
          <VehicleImageFields
            enabled={supabaseEnabled}
            admin={{ url: adminPending?.preview ?? adminSaved, isNew: !!adminPending }}
            hero={{ url: heroPending?.preview ?? heroSaved, isNew: !!heroPending }}
            photos={{ saved: savedUrls, pending: pendingPreviews }}
            onPick={handleFileSelect}
            onClear={clearSingle}
            onRemoveSaved={removeSavedUrl}
            onRemovePending={removePending}
          />

          {/* ── Insurance ───────────────────────────────────────────────────── */}
          <div className="sm:col-span-2">
            <div className="flex items-center gap-2 mb-3 mt-1">
              <Shield size={14} className="text-navy-400" />
              <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide">Insurance Details</p>
            </div>
            {!isInsuranceComplete(form) && (
              <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-xl px-3 py-2.5 mb-3 text-xs text-orange-700">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Insurance details are incomplete</p>
                  <p className="text-orange-600 mt-0.5">A weekly reminder will be sent to the owner until all four fields are filled in.</p>
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Provider">
                <input className="input" value={form.insurance.provider} onChange={(e) => setIns('provider', e.target.value)} />
              </Field>
              <Field label="Policy Number">
                <input className="input" value={form.insurance.policyNumber} onChange={(e) => setIns('policyNumber', e.target.value)} />
              </Field>
              <Field label="Expiry Date">
                <DateInput value={form.insurance.expiryDate} onChange={(v) => setIns('expiryDate', v)} />
              </Field>
              <Field label="Premium (Rs)">
                <input className="input" type="number" value={form.insurance.premium} onChange={(e) => setIns('premium', +e.target.value)} />
              </Field>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setModal(null)} className="btn-secondary" disabled={uploading}>Cancel</button>
          <button onClick={handleSave} className="btn-primary disabled:opacity-60" disabled={uploading}>
            {uploading ? 'Uploading…' : modal === 'add' ? 'Add Vehicle' : 'Save Changes'}
          </button>
        </div>
      </Modal>

      {/* View Modal */}
      <Modal open={modal === 'view'} onClose={() => setModal(null)} title="Vehicle Details" width="max-w-lg">
        {selected && (() => {
          const owner = owners.find((o) => o.id === selected.ownerId);
          return (
            <div className="space-y-4">
              {(() => {
                // Real vehicle photos first; fall back to the hero and admin images
                const imgs = selected.photoUrls && selected.photoUrls.length > 0
                  ? selected.photoUrls
                  : [selected.heroImageUrl, selected.imageUrl].filter((u): u is string => !!u);
                const clampedIdx = Math.min(galleryIndex, Math.max(0, imgs.length - 1));

                if (imgs.length > 0) {
                  return (
                    <div className="space-y-2">
                      {/* Main image */}
                      <div className="relative w-full h-48 rounded-2xl overflow-hidden bg-navy-900/5 ring-1 ring-navy-100">
                        <img
                          src={imgs[clampedIdx]}
                          alt={`${selected.brand} ${selected.model}`}
                          className="w-full h-full object-cover"
                        />
                        {imgs.length > 1 && (
                          <>
                            <button
                              onClick={() => setGalleryIndex((i) => (i - 1 + imgs.length) % imgs.length)}
                              className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60 transition-colors"
                            ><ChevronLeft size={14} /></button>
                            <button
                              onClick={() => setGalleryIndex((i) => (i + 1) % imgs.length)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60 transition-colors"
                            ><ChevronRight size={14} /></button>
                            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                              {imgs.map((_, i) => (
                                <button
                                  key={i}
                                  onClick={() => setGalleryIndex(i)}
                                  className={`w-1.5 h-1.5 rounded-full transition-colors ${i === clampedIdx ? 'bg-white' : 'bg-white/40'}`}
                                />
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                      {/* Thumbnail strip */}
                      {imgs.length > 1 && (
                        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
                          {imgs.map((url, i) => (
                            <button
                              key={url}
                              onClick={() => setGalleryIndex(i)}
                              className={`flex-shrink-0 w-14 h-10 rounded-lg overflow-hidden ring-2 transition-all ${i === clampedIdx ? 'ring-navy-600' : 'ring-transparent opacity-60 hover:opacity-90'}`}
                            >
                              <img src={url} alt="" className="w-full h-full object-cover" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <div className="w-full h-40 rounded-2xl flex flex-col items-center justify-center gap-2 bg-gradient-to-b from-navy-50/80 to-navy-100/50 ring-1 ring-dashed ring-navy-200">
                    <div className="w-10 h-10 rounded-full bg-navy-100 flex items-center justify-center">
                      <Camera size={18} className="text-navy-400" />
                    </div>
                    <p className="text-xs text-navy-400">No photos yet — add one via Edit</p>
                  </div>
                );
              })()}

              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-navy-800">{selected.brand} {selected.model}</h3>
                  <p className="text-sm text-navy-400">{selected.vehicleNumber} · {selected.year}</p>
                </div>
                <StatusBadge status={selected.status} size="md" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Owner',         owner?.name ?? '—'],
                  ['Daily Rent',    `Rs ${selected.dailyRent.toLocaleString()}`],
                  ['Included km',   `${selected.includedKmPerDay ?? 100} km/day`],
                  ['Extra km rate', `Rs ${selected.extraKmRate ?? 50}/km`],
                  ['Color',         selected.color ?? '—'],
                  ['Fuel',          selected.fuelType ?? '—'],
                  ['Transmission',  selected.transmission ?? '—'],
                  ['Seats',         selected.seats ?? '—'],
                  ['Mileage',       selected.mileage ? `${selected.mileage.toLocaleString()} km` : '—'],
                  ['Revenue',       `Rs ${vehicleNetRevenue(selected, bookings).toLocaleString()}`],
                  ...(selected.revenue !== vehicleNetRevenue(selected, bookings)
                    ? [['Gross Revenue', `Rs ${selected.revenue.toLocaleString()} (before discounts)`] as [string, string]]
                    : []),
                  ['Total Rentals', selected.rentCount ?? 0],
                ].map(([label, val]) => (
                  <div key={String(label)} className="bg-navy-50/60 rounded-xl p-3">
                    <p className="text-xs text-navy-400">{label}</p>
                    <p className="text-sm font-semibold text-navy-800 mt-0.5">{val}</p>
                  </div>
                ))}
              </div>

              <div className="bg-navy-50/60 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Shield size={14} className="text-navy-400" />
                  <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide">Insurance</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><p className="text-xs text-navy-400">Provider</p><p className="font-medium text-navy-700">{selected.insurance.provider || '—'}</p></div>
                  <div><p className="text-xs text-navy-400">Policy #</p><p className="font-medium text-navy-700">{selected.insurance.policyNumber || '—'}</p></div>
                  <div><p className="text-xs text-navy-400">Expiry</p><p className="font-medium text-navy-700">{selected.insurance.expiryDate || '—'}</p></div>
                  <div><p className="text-xs text-navy-400">Premium</p><p className="font-medium text-navy-700">Rs {selected.insurance.premium.toLocaleString()}</p></div>
                </div>
              </div>

              {/* Customer reviews — shown on the website's vehicle details when published */}
              <VehicleReviews vehicleId={selected.id} canEdit={isAdmin() || canActOn(selected)} />

              <div className="flex gap-3">
                {canActOn(selected) && can('canEditVehicle') && (
                  <button onClick={() => { setModal(null); openEdit(selected); }} className="btn-secondary flex-1">Edit</button>
                )}
                <button onClick={() => setModal(null)} className="btn-primary flex-1">Close</button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Crop modal — appears above the form modal when a file is selected */}
      {cropSrc && (
        <CropModal
          src={cropSrc}
          fileName={cropFile?.name ?? 'image.jpg'}
          aspectRatio={SLOT_ASPECT[cropSlot]}
          onSave={handleCropSave}
          onSkip={handleCropSkip}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="label">{label}</p>
      {children}
    </div>
  );
}
