import { useState, useRef, useEffect } from 'react';
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
import VehicleBreakdownHistory from '../components/breakdowns/VehicleBreakdownHistory';
import { useBreakdownStore } from '../store/useBreakdownStore';
import VehicleReviews from '../components/ui/VehicleReviews';
import Select from '../components/ui/Select';
import DateInput from '../components/ui/DateInput';
import { Plus, Car, Pencil, Trash2, Shield, CalendarDays, Wrench, TrendingUp, Camera, Upload, X, ChevronLeft, ChevronRight, AlertTriangle, UserRound } from 'lucide-react';
import { Vehicle, VehicleStatus } from '../types';
import { isInsuranceComplete, clearInsuranceReminder } from '../lib/insuranceReminder';
import { vehicleMoney } from '../lib/revenue';
import { VEHICLE_CATEGORIES, categoryLabel, guessCategory } from '../lib/vehicleCategory';

const STATUS_OPTIONS: VehicleStatus[] = ['Available', 'Reserved', 'Ongoing', 'Maintenance'];
const FUEL_TYPES    = ['Petrol', 'Diesel', 'Hybrid', 'Electric', 'CNG'];
const TRANSMISSIONS = ['Manual', 'Automatic', 'CVT', 'Semi-Automatic'];
const MAX_HEROES = 3;   // hero images per vehicle — the admin picks which one the website shows

const empty = (): Omit<Vehicle, 'id' | 'createdAt' | 'revenue' | 'rentCount'> => ({
  vehicleNumber: '',
  brand: '',
  model: '',
  webCategory: '',
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
  const [viewTab, setViewTab] = useState<'details' | 'breakdowns'>('details');
  const breakdowns = useBreakdownStore();
  useEffect(() => { if (!breakdowns.ready) breakdowns.load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const { vehicles, owners, bookings, expenses, commissions, addVehicle, updateVehicle, deleteVehicle } = useStore();
  const { currentUser, can, isAdmin } = useAuthStore();

  const [filter,   setFilter]   = useState<VehicleStatus | 'All'>('All');
  const [modal,    setModal]    = useState<'add' | 'edit' | 'view' | null>(null);
  const [selected, setSelected] = useState<Vehicle | null>(null);
  const [form,     setForm]     = useState(empty());
  const [typeError, setTypeError] = useState(false);
  const [uploading,       setUploading]       = useState(false);
  // the vehicle photos, in the order shown on the website: saved ones (url) and new ones (file), mixed and re-orderable
  const [photoItems,      setPhotoItems]      = useState<PhotoItem[]>([]);
  const [galleryIndex,    setGalleryIndex]    = useState(0);
  const [uploadingFor,    setUploadingFor]    = useState<string | null>(null);
  const [cropFile,        setCropFile]        = useState<File | null>(null);
  const [cropSrc,         setCropSrc]         = useState<string | null>(null);
  // Admin image (cut-out) and hero image: one each — saved URL plus an optional new file
  const [adminSaved,      setAdminSaved]      = useState<string | null>(null);
  const [adminPending,    setAdminPending]    = useState<{ file: File; preview: string } | null>(null);
  // Hero images: up to 3 (saved URLs + new files); heroShown = the one the website shows (its URL / preview)
  const [heroSaved,       setHeroSaved]       = useState<string[]>([]);
  const [heroPending,     setHeroPending]     = useState<{ file: File; preview: string }[]>([]);
  const [heroShown,       setHeroShown]       = useState<string | null>(null);
  const heroSavedRef = useRef<string[]>([]);
  heroSavedRef.current = heroSaved;   // read inside the async file reader
  const [cropSlot,        setCropSlot]        = useState<ImageSlot>('photos');
  const cardFileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef  = useRef<string | null>(null);
  const cropQueueRef     = useRef<File[]>([]);
  const cropSlotRef      = useRef<ImageSlot>('photos');
  // re-cropping an image that's already there: which one gets the new crop
  const recropRef        = useRef<{ slot: ImageSlot; key: string } | null>(null);

  const isOwnerRole = !isAdmin() && currentUser?.role === 'owner';
  // team members work on every car (what they may change is set by their abilities); owners on their own
  const teamLogin   = currentUser?.role === 'staff';
  const canActOn    = (v: Vehicle) => isAdmin() || teamLogin || v.ownerId === currentUser?.ownerId;
  // the owner, rent and km terms are Brian's — shown to the team, not editable (the database keeps them too)
  const termsLocked = teamLogin;

  const filtered = filter === 'All' ? vehicles : vehicles.filter((v) => v.status === filter);

  // For owner role: split into mine vs others
  const myFiltered     = isOwnerRole ? filtered.filter((v) => v.ownerId === currentUser?.ownerId) : filtered;
  const othersFiltered = isOwnerRole ? filtered.filter((v) => v.ownerId !== currentUser?.ownerId) : [];

  // savedUrls / pendingFiles / pendingPreviews hold the VEHICLE PHOTOS gallery
  const resetImageState = (v?: Vehicle) => {
    setPhotoItems((v?.photoUrls ?? []).map((u) => ({ key: u, url: u, preview: u })));
    recropRef.current = null;
    setAdminSaved(v?.imageUrl ?? null);
    setAdminPending(null);
    const heroes = v?.heroImages?.length ? v.heroImages : v?.heroImageUrl ? [v.heroImageUrl] : [];
    setHeroSaved(heroes.slice(0, MAX_HEROES));
    setHeroPending([]);
    setHeroShown(v?.heroImageUrl ?? heroes[0] ?? null);
    setGalleryIndex(0);
  };

  const openAdd = () => { setForm(empty()); setTypeError(false); resetImageState(); setModal('add'); };
  const openEdit = (v: Vehicle) => {
    setSelected(v);
    setForm({ ...v });
    setTypeError(false);
    resetImageState(v);
    setModal('edit');
  };
  const openView = (v: Vehicle, allowView = true) => {
    if (!allowView) return;
    setSelected(v);
    setGalleryIndex(0);
    setViewTab('details');
    setModal('view');
  };

  const newKey = () => `new-${Math.random().toString(36).slice(2, 10)}`;
  const addFileToPending = (file: File, replaceKey?: string) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const item: PhotoItem = { key: newKey(), file, preview: e.target!.result as string };
      setPhotoItems((prev) => (replaceKey ? prev.map((p) => (p.key === replaceKey ? item : p)) : [...prev, item]));
    };
    reader.readAsDataURL(file);
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
    const re = recropRef.current; recropRef.current = null;
    if (slot === 'photos') { addFileToPending(file, re?.key); return; }
    if (re && slot === 'hero') {
      // the re-cropped hero takes the old one's place (and stays the shown one if it was)
      const reader = new FileReader();
      reader.onload = (e) => {
        const next = { file, preview: e.target!.result as string };
        if (heroSavedRef.current.includes(re.key)) { setHeroSaved((l) => l.filter((u) => u !== re.key)); setHeroPending((l) => [...l, next]); }
        else setHeroPending((l) => l.map((h) => (h.preview === re.key ? next : h)));
        setHeroShown((cur) => (cur === re.key ? next.preview : cur));
      };
      reader.readAsDataURL(file);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const next = { file, preview: e.target!.result as string };
      if (slot === 'admin') { setAdminPending(next); return; }
      // a hero image goes into a free slot (max 3); the first one becomes the shown one
      setHeroPending((list) => (heroSavedRef.current.length + list.length >= MAX_HEROES ? list : [...list, next]));
      setHeroShown((cur) => cur ?? next.preview);
    };
    reader.readAsDataURL(file);
  };
  const handleCropSave = (croppedFile: File) => { acceptFile(croppedFile); advanceCropQueue(); };
  // "use as it is": a new file goes in uncropped; a re-crop that's skipped leaves the image as it was
  const handleCropSkip = () => { if (recropRef.current) recropRef.current = null; else if (cropFile) acceptFile(cropFile); advanceCropQueue(); };

  // open the cropper again on an image that's already there (saved on the website or just added)
  const recrop = async (slot: ImageSlot, key: string) => {
    const src = slot === 'photos' ? photoItems.find((p) => p.key === key)?.preview : slot === 'admin' ? (adminPending?.preview ?? adminSaved ?? undefined) : key;
    if (!src) return;
    try {
      const blob = await (await fetch(src)).blob();
      const file = new File([blob], `${slot}-${Date.now()}.${(blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`, { type: blob.type || 'image/jpeg' });
      cropSlotRef.current = slot; setCropSlot(slot);
      recropRef.current = { slot, key };
      cropQueueRef.current = [];
      startCropFor(file);
    } catch {
      toast.error('Could not open the image', 'Download it and upload it again to crop it.');
    }
  };
  const movePhoto = (from: number, to: number) => setPhotoItems((list) => {
    if (to < 0 || to >= list.length || from === to) return list;
    const next = [...list]; const [it] = next.splice(from, 1); next.splice(to, 0, it); return next;
  });

  const handleFileSelect = (slot: ImageSlot, files: FileList | null) => {
    if (!files) return;
    const accepted = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!accepted.length) return;
    cropSlotRef.current = slot;
    setCropSlot(slot);
    // Admin takes a single image; hero images fill the free slots (up to 3); vehicle photos can be several
    const freeHero = MAX_HEROES - heroSaved.length - heroPending.length;
    if (slot === 'hero' && freeHero <= 0) { toast.warning('Hero images are full', 'Remove one first — up to 3 per vehicle.'); return; }
    cropQueueRef.current = slot === 'photos' ? accepted.slice(1) : slot === 'hero' ? accepted.slice(1, freeHero) : [];
    startCropFor(accepted[0]);
  };

  const clearSingle = (slot: 'admin' | 'hero') => {
    if (slot === 'admin') { setAdminSaved(null); setAdminPending(null); }
    else { setHeroSaved([]); setHeroPending([]); setHeroShown(null); }
  };

  const removeHero = (url: string) => {
    const rest = [...heroSaved, ...heroPending.map((h) => h.preview)].filter((u) => u !== url);
    setHeroSaved((list) => list.filter((u) => u !== url));
    setHeroPending((list) => list.filter((h) => h.preview !== url));
    if (heroShown === url) setHeroShown(rest[0] ?? null);
  };
  const removePhoto = (key: string) => setPhotoItems((prev) => prev.filter((p) => p.key !== key));

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
    const hold = modal === 'edit' && selected ? breakdowns.activeHold(selected.id) : undefined;
    if (hold && form.status !== 'Maintenance') {
      toast.error('Vehicle under maintenance', `Breakdown ${hold.ref} is holding it — use "Mark vehicle as ready" on that breakdown.`);
      return;
    }
    const missing = [
      !form.vehicleNumber.trim() && 'vehicle number',
      !form.brand.trim() && 'brand',
      !form.model.trim() && 'model',
    ].filter(Boolean);
    if (missing.length) {
      toast.error('Details missing', `Fill in the ${missing.join(', ')}.`);
      return;
    }
    if (!form.webCategory) {
      setTypeError(true);
      toast.error('Vehicle type missing', 'Choose Economy, Sedan, Hybrid, SUV, Luxury or Van.');
      return;
    }
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
      // hero images: upload the new ones, keep the order, and work out which URL is shown
      const uploadedHeroes: { preview: string; url: string }[] = [];
      for (const h of heroPending) {
        const url = await upload(h.file);
        if (url) uploadedHeroes.push({ preview: h.preview, url });
      }
      const heroList = [...heroSaved, ...uploadedHeroes.map((h) => h.url)].slice(0, MAX_HEROES);
      const shownUrl = uploadedHeroes.find((h) => h.preview === heroShown)?.url ?? heroShown;
      const heroUrl = (shownUrl && heroList.includes(shownUrl) ? shownUrl : heroList[0]) ?? null;
      // the photos in the order arranged: saved ones keep their URL, new / re-cropped ones are uploaded in place
      const photoUrls: string[] = [];
      for (const p of photoItems) {
        const url = p.url ?? (p.file ? await upload(p.file) : null);
        if (url) photoUrls.push(url);
      }

      // Only send image fields that changed, so vehicles without the new
      // hero/photo columns (migration not run yet) can still be edited.
      const orig = modal === 'edit' ? selected : null;
      const imageUpdates: Partial<Vehicle> = {};
      if (adminUrl !== (orig?.imageUrl ?? null)) {
        imageUpdates.imageUrl = adminUrl ?? undefined;
        imageUpdates.imageUrls = adminUrl ? [adminUrl] : [];
      }
      if (heroUrl !== (orig?.heroImageUrl ?? null)) imageUpdates.heroImageUrl = heroUrl ?? undefined;
      const origHeroes = orig?.heroImages?.length ? orig.heroImages : orig?.heroImageUrl ? [orig.heroImageUrl] : [];
      if (JSON.stringify(heroList) !== JSON.stringify(origHeroes)) imageUpdates.heroImages = heroList;
      if (JSON.stringify(photoUrls) !== JSON.stringify(orig?.photoUrls ?? [])) imageUpdates.photoUrls = photoUrls;

      // Delete replaced/removed files from storage (best-effort)
      if (orig) {
        if (orig.imageUrl && orig.imageUrl !== adminUrl) deleteVehicleImage(orig.imageUrl);
        origHeroes.filter((u) => !heroList.includes(u)).forEach(deleteVehicleImage);
        (orig.photoUrls ?? []).filter((u) => !photoUrls.includes(u)).forEach(deleteVehicleImage);
      }

      if (modal === 'edit') {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { imageUrl, imageUrls, heroImageUrl, heroImages: _h, photoUrls: _p, ...details } = form as Vehicle;
        // Only send the spec fields if they changed (keeps edits working before website.sql adds them)
        if (details.fuelEfficiency === (selected?.fuelEfficiency ?? undefined)) delete details.fuelEfficiency;
        if (details.tankCapacity === (selected?.tankCapacity ?? undefined)) delete details.tankCapacity;
        if ((details.hillSuitable ?? null) === (selected?.hillSuitable ?? null)) delete details.hillSuitable;
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
    const active = bookings.some((b) => b.vehicleId === id && (b.status === 'Confirmed' || b.status === 'Ongoing'));
    // with an active booking the store refuses and explains why — no point asking first
    if (active || confirm('Delete this vehicle?')) deleteVehicle(id);
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
              <p className="text-xs text-navy-400">
                {v.vehicleNumber} · {v.year} ·{' '}
                {categoryLabel(v.webCategory)
                  ? <span className="font-medium text-navy-600">{categoryLabel(v.webCategory)}</span>
                  : <span className="font-medium text-amber-600">Type not set</span>}
              </p>
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
          <div className="min-w-0">
            {(() => { const m = vehicleMoney(v.id, bookings, commissions); return (<>
              <p className="text-xs text-navy-400 whitespace-nowrap" title="Final bills (rent + extra charges − discount) of completed and on-rent trips">Earned · {m.trips} trip{m.trips === 1 ? '' : 's'}{m.onRent ? ` (${m.onRent} on rent)` : ''}</p>
              <p className="text-sm font-bold text-navy-700 whitespace-nowrap">Rs {m.earned.toLocaleString()}</p>
              {(m.upcoming > 0 || m.company > 0) && (
                <p className="text-[11px] text-navy-400 whitespace-nowrap">
                  {m.upcoming > 0 && <span className="text-sky-600">+ Rs {m.upcoming.toLocaleString()} upcoming ({m.upcomingCount})</span>}
                  {m.upcoming > 0 && m.company > 0 && ' · '}
                  {m.company > 0 && <>company Rs {m.company.toLocaleString()}</>}
                </p>
              )}
            </>); })()}
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
        {(isAdmin() || (isOwnerRole && can('canEditVehicle'))) && (
          <button onClick={openAdd} className="btn-primary flex items-center gap-2 flex-shrink-0">
            <Plus size={15} /> Add Vehicle
          </button>
        )}
      </div>

      {/* Grid — owner sees own vehicles first, then others */}
      {isOwnerRole ? (
        <>
          <SectionLabel count={myFiltered.length}>My Vehicles</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1700px]:grid-cols-5 gap-4 mb-8">
            {myFiltered.length > 0
              ? myFiltered.map((v) => renderCard(v, true))
              : <div className="col-span-3 text-center py-10 text-navy-400 text-sm">No vehicles under your ownership.</div>
            }
          </div>

          {othersFiltered.length > 0 && (
            <>
              <SectionLabel count={othersFiltered.length}>Other Fleet Vehicles</SectionLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1700px]:grid-cols-5 gap-4">
                {othersFiltered.map((v) => renderCard(v, false))}
              </div>
            </>
          )}
        </>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1700px]:grid-cols-5 gap-4">
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
        width="max-w-5xl"
      >
        <div className="flex flex-col gap-4">
          {/* ── 1 · Identity ── */}
          <Section icon={<Car size={16} />} title="Vehicle details" hint="How the vehicle is identified in bookings, invoices and on the website.">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <Field label="Vehicle number" required>
                <input className="input" value={form.vehicleNumber} onChange={(e) => set('vehicleNumber', e.target.value)} placeholder="CAB-1234" />
              </Field>
              <Field label="Brand" required>
                <input className="input" value={form.brand} onChange={(e) => set('brand', e.target.value)} placeholder="Toyota" />
              </Field>
              <Field label="Model" required>
                <input className="input" value={form.model} onChange={(e) => set('model', e.target.value)} placeholder="Prius" />
              </Field>
              <Field label="Year">
                <input className="input" type="number" value={form.year} onChange={(e) => set('year', +e.target.value)} />
              </Field>
              <Field label="Colour">
                <input className="input" value={form.color ?? ''} onChange={(e) => set('color', e.target.value)} placeholder="Silver" />
              </Field>
            </div>
            <div className="mt-4">
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <p className="label !mb-0">Vehicle type <span className="text-red-500">*</span></p>
                {!form.webCategory && (
                  <button type="button" className="text-[11px] text-navy-500 hover:text-navy-800 underline underline-offset-2"
                    onClick={() => { set('webCategory', guessCategory(form)); setTypeError(false); }}>
                    Suggest: {categoryLabel(guessCategory(form))}<span className="hidden sm:inline"> (from seats & fuel)</span>
                  </button>
                )}
              </div>
              <div role="radiogroup" aria-label="Vehicle type"
                   className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 rounded-xl ${typeError ? 'ring-2 ring-red-300 ring-offset-2' : ''}`}>
                {VEHICLE_CATEGORIES.map((c) => {
                  const on = form.webCategory === c.id;
                  return (
                    <button key={c.id} type="button" role="radio" aria-checked={on}
                      onClick={() => { set('webCategory', c.id); setTypeError(false); }}
                      className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${on
                        ? 'border-navy-800 bg-navy-800 text-white shadow-sm'
                        : 'border-navy-100 bg-white hover:border-navy-300 hover:bg-navy-50/60'}`}>
                      <p className={`text-sm font-semibold ${on ? 'text-white' : 'text-navy-800'}`}>{c.label}</p>
                      <p className={`text-[11px] leading-snug mt-0.5 ${on ? 'text-white/70' : 'text-navy-400'}`}>{c.hint}</p>
                    </button>
                  );
                })}
              </div>
              {typeError && <p className="text-[11px] text-red-600 mt-1.5">Choose the vehicle type — it decides where the car shows on the website.</p>}
            </div>
          </Section>

          {/* ── 2 · Owner & availability ── */}
          <Section icon={<UserRound size={16} />} title="Owner & availability" hint="Who the car belongs to and whether it can be booked.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Owner">
                <Select value={form.ownerId} onChange={(v) => set('ownerId', v)} placeholder="Select owner" nullable searchable disabled={termsLocked}
                  options={owners.map((o) => ({ value: o.id, label: o.name }))} />
              </Field>
              <Field label="Status">
                <Select value={form.status} onChange={(v) => set('status', v as VehicleStatus)}
                  disabled={!!(modal === 'edit' && selected && breakdowns.activeHold(selected.id))}
                  options={STATUS_OPTIONS.map((s) => ({ value: s, label: s }))} />
                {modal === 'edit' && selected && breakdowns.activeHold(selected.id) && (
                  <p className="text-[11px] text-red-600 mt-1">Under maintenance (breakdown {breakdowns.activeHold(selected.id)!.ref}) — returns to service only through “Mark vehicle as ready” on that breakdown.</p>
                )}
              </Field>
            </div>
          </Section>

          {/* ── 3 · Pricing & km terms ── */}
          <Section icon={<TrendingUp size={16} />} title="Rent & mileage terms" hint={termsLocked ? 'Set by the Managing Director — ask Brian to change the owner, rent or km terms.' : 'Used to price every booking and the extra-km charge at return.'}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Field label="Daily rent">
                <Affix prefix="Rs">
                  <input className="input pl-10" type="number" min="0" value={form.dailyRent} disabled={termsLocked} onChange={(e) => set('dailyRent', +e.target.value)} />
                </Affix>
              </Field>
              <Field label="Included km">
                <Affix suffix="km / day">
                  <input className="input pr-20" type="number" min="0" value={form.includedKmPerDay ?? 100} disabled={termsLocked} onChange={(e) => set('includedKmPerDay', +e.target.value)} placeholder="100" />
                </Affix>
              </Field>
              <Field label="Extra km rate">
                <Affix prefix="Rs" suffix="/ km">
                  <input className="input pl-10 pr-12" type="number" min="0" value={form.extraKmRate ?? 50} disabled={termsLocked} onChange={(e) => set('extraKmRate', +e.target.value)} placeholder="50" />
                </Affix>
              </Field>
              <Field label="Hill country">
                <Select value={form.hillSuitable == null ? '' : form.hillSuitable ? 'yes' : 'no'}
                  onChange={(v) => set('hillSuitable', v === '' ? null : v === 'yes')} placeholder="Not set" nullable
                  options={[{ value: 'yes', label: 'Suitable', sub: 'Kandy, Nuwara Eliya, Ella…' }, { value: 'no', label: 'Not suitable', sub: 'Flat roads only' }]} />
              </Field>
            </div>
            {form.dailyRent > 0 && (
              <p className="text-xs text-navy-500 bg-navy-50/70 rounded-lg px-3 py-2 mt-3">
                Customer pays <b className="text-navy-800">Rs {form.dailyRent.toLocaleString()}</b> a day with{' '}
                <b className="text-navy-800">{(form.includedKmPerDay ?? 100).toLocaleString()} km</b> included; each km over that costs{' '}
                <b className="text-navy-800">Rs {(form.extraKmRate ?? 50).toLocaleString()}</b>.
              </p>
            )}
          </Section>

          {/* ── 4 · Specifications ── */}
          <Section icon={<Wrench size={16} />} title="Specifications" hint="Shown to customers and used to match inquiries.">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <Field label="Fuel type">
                <Select value={form.fuelType ?? ''} onChange={(v) => set('fuelType', v)}
                  options={FUEL_TYPES.map((f) => ({ value: f, label: f }))} />
              </Field>
              <Field label="Transmission">
                <Select value={form.transmission ?? ''} onChange={(v) => set('transmission', v)}
                  options={TRANSMISSIONS.map((t) => ({ value: t, label: t }))} />
              </Field>
              <Field label="Seats">
                <input className="input" type="number" min="1" value={form.seats ?? 5} onChange={(e) => set('seats', +e.target.value)} />
              </Field>
              <Field label="Odometer">
                <Affix suffix="km">
                  <input className="input pr-10" type="number" min="0" value={form.mileage ?? 0} onChange={(e) => set('mileage', +e.target.value)} />
                </Affix>
              </Field>
              <Field label="Fuel efficiency">
                <Affix suffix="km / L">
                  <input className="input pr-16" type="number" step="0.1" min="0" placeholder="e.g. 18"
                         value={form.fuelEfficiency ?? ''}
                         onChange={(e) => set('fuelEfficiency', e.target.value === '' ? null : +e.target.value)} />
                </Affix>
              </Field>
              <Field label="Fuel tank">
                <Affix suffix="litres">
                  <input className="input pr-16" type="number" step="0.1" min="0" placeholder="e.g. 36"
                         value={form.tankCapacity ?? ''}
                         onChange={(e) => set('tankCapacity', e.target.value === '' ? null : +e.target.value)} />
                </Affix>
              </Field>
            </div>
          </Section>

          {/* ── 5 · Images: admin cut-out, website hero, real photos ── */}
          <Section icon={<Camera size={16} />} title="Images" hint="Admin image for this panel, hero images for the website, and real photos.">
            <VehicleImageFields
              bare
              enabled={supabaseEnabled}
              admin={{ url: adminPending?.preview ?? adminSaved, isNew: !!adminPending }}
              heroes={[...heroSaved.map((url) => ({ url, isNew: false })), ...heroPending.map((h) => ({ url: h.preview, isNew: true }))]}
              heroShown={heroShown}
              onShowHero={setHeroShown}
              onRemoveHero={removeHero}
              photos={photoItems.map((p) => ({ key: p.key, preview: p.preview, isNew: !p.url }))}
              onPick={handleFileSelect}
              onClear={clearSingle}
              onRemovePhoto={removePhoto}
              onMovePhoto={movePhoto}
              onRecrop={recrop}
            />
          </Section>

          {/* ── 6 · Insurance ── */}
          <Section icon={<Shield size={16} />} title="Insurance"
            hint="All four fields stop the weekly reminder to the owner."
            badge={isInsuranceComplete(form)
              ? <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">Complete</span>
              : <span className="text-[11px] font-semibold text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full">Incomplete</span>}>
            {!isInsuranceComplete(form) && (
              <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-xl px-3 py-2.5 mb-4 text-xs text-orange-700">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                <p>A weekly reminder goes to the owner until the provider, policy number, expiry date and premium are filled in.</p>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Field label="Provider">
                <input className="input" value={form.insurance.provider} onChange={(e) => setIns('provider', e.target.value)} placeholder="e.g. Ceylinco" />
              </Field>
              <Field label="Policy number">
                <input className="input" value={form.insurance.policyNumber} onChange={(e) => setIns('policyNumber', e.target.value)} />
              </Field>
              <Field label="Expiry date">
                <DateInput value={form.insurance.expiryDate} onChange={(v) => setIns('expiryDate', v)} />
              </Field>
              <Field label="Premium">
                <Affix prefix="Rs">
                  <input className="input pl-10" type="number" min="0" value={form.insurance.premium} onChange={(e) => setIns('premium', +e.target.value)} />
                </Affix>
              </Field>
            </div>
          </Section>
        </div>

        {/* footer stays in view while the form scrolls */}
        <div className="sticky bottom-0 -mx-5 -mb-5 mt-5 px-5 py-3.5 bg-white/95 backdrop-blur border-t border-navy-100 flex items-center justify-between gap-3 z-10">
          <p className="text-[11px] text-navy-400 hidden sm:block"><span className="text-red-500">*</span> Required</p>
          <div className="flex gap-3 ml-auto">
            <button onClick={() => setModal(null)} className="btn-secondary" disabled={uploading}>Cancel</button>
            <button onClick={handleSave} className="btn-primary disabled:opacity-60" disabled={uploading}>
              {uploading ? 'Uploading…' : modal === 'add' ? 'Add vehicle' : 'Save changes'}
            </button>
          </div>
        </div>
      </Modal>

      {/* View Modal */}
      <Modal open={modal === 'view'} onClose={() => setModal(null)} title="Vehicle Details" width="max-w-lg">
        {selected && (() => {
          const owner = owners.find((o) => o.id === selected.ownerId);
          return (
            <div className="space-y-4">
              {(isAdmin() || teamLogin) && (
                <div className="flex gap-1 bg-navy-50 rounded-xl p-1 text-sm font-semibold">
                  {([['details', 'Details'], ['breakdowns', `Breakdown history (${breakdowns.incidents.filter((x) => x.vehicleId === selected.id).length})`]] as const).map(([k, label]) => (
                    <button key={k} type="button" onClick={() => setViewTab(k)} className={`flex-1 rounded-lg py-1.5 ${viewTab === k ? 'bg-white text-navy-900 shadow-sm' : 'text-navy-500'}`}>{label}</button>
                  ))}
                </div>
              )}
              {viewTab === 'breakdowns' && (isAdmin() || teamLogin) ? (
                <VehicleBreakdownHistory vehicleId={selected.id} onOpen={() => setModal(null)} />
              ) : (<>
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
                  ['Vehicle type',  categoryLabel(selected.webCategory) ?? 'Not set'],
                  ['Owner',         owner?.name ?? '—'],
                  ['Daily Rent',    `Rs ${selected.dailyRent.toLocaleString()}`],
                  ['Included km',   `${selected.includedKmPerDay ?? 100} km/day`],
                  ['Extra km rate', `Rs ${selected.extraKmRate ?? 50}/km`],
                  ['Hill country',  selected.hillSuitable == null ? 'Not set' : selected.hillSuitable ? 'Suitable' : 'Not suitable'],
                  ['Color',         selected.color ?? '—'],
                  ['Fuel',          selected.fuelType ?? '—'],
                  ['Transmission',  selected.transmission ?? '—'],
                  ['Seats',         selected.seats ?? '—'],
                  ['Mileage',       selected.mileage ? `${selected.mileage.toLocaleString()} km` : '—'],
                  ...(() => { const m = vehicleMoney(selected.id, bookings, commissions); return [
                    ['Earned', `Rs ${m.earned.toLocaleString()} · ${m.trips} trip${m.trips === 1 ? '' : 's'} (completed + on rent)`],
                    ['Upcoming', m.upcomingCount ? `Rs ${m.upcoming.toLocaleString()} · ${m.upcomingCount} confirmed` : 'None'],
                    ['Company commission', `Rs ${m.company.toLocaleString()} on the earned trips`],
                  ] as [string, string][]; })(),
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
              <VehicleReviews vehicleId={selected.id} canEdit={isAdmin() || (teamLogin ? can('canViewFeedback') : canActOn(selected))} />

              <div className="flex gap-3">
                {canActOn(selected) && can('canEditVehicle') && (
                  <button onClick={() => { setModal(null); openEdit(selected); }} className="btn-secondary flex-1">Edit</button>
                )}
                <button onClick={() => setModal(null)} className="btn-primary flex-1">Close</button>
              </div>
              </>)}
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

/** one vehicle photo in the editor: a saved one (url) or a new / re-cropped one (file) */
interface PhotoItem { key: string; url?: string; file?: File; preview: string }

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <p className="label">{label}{required && <span className="text-red-500"> *</span>}</p>
      {children}
    </div>
  );
}

/** A titled group in the Add / Edit Vehicle form */
function Section({ icon, title, hint, badge, children }: {
  icon: React.ReactNode; title: string; hint?: string; badge?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-navy-100 bg-white p-4 sm:p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-navy-50 text-navy-600 flex items-center justify-center flex-shrink-0">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-navy-800">{title}</h3>
            {badge}
          </div>
          {hint && <p className="text-xs text-navy-400 mt-0.5">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Unit labels inside an input ("Rs", "km / day") */
function Affix({ prefix, suffix, children }: { prefix?: string; suffix?: string; children: React.ReactNode }) {
  return (
    <div className="relative">
      {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-navy-400 pointer-events-none">{prefix}</span>}
      {children}
      {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-navy-400 pointer-events-none">{suffix}</span>}
    </div>
  );
}
