import type {ReactNode} from 'react';
import CameraFaceOverlay from '@/components/camera-face-overlay';
import CameraLiveComparison from '@/components/camera-live-comparison';
import './camera-overlay.css';
import './live-comparison.css';
export default function Template({children}:{children:ReactNode}){return <>{children}<CameraFaceOverlay/><CameraLiveComparison/></>;}
