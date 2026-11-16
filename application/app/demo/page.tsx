import {Suspense} from 'react';
import type {Metadata} from 'next';
import RecruiterDemo from '@/components/recruiter-demo';
import './demo.css';
export const metadata:Metadata={title:'Recruiter Demo | Face Recognition Attendance System',description:'Explore attendance, courses, accounts, receipts, analytics and optional real camera comparison with sample records. No registration or approval required.',robots:{index:false,follow:false}};
export default function DemoPage(){return <Suspense fallback={<main className="demo-loading"><h1>Opening the recruiter demo…</h1></main>}><RecruiterDemo/></Suspense>;}
