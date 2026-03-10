"use client";

import dynamic from 'next/dynamic';

const MapZoneView = dynamic(() => import('./MapZoneViewImpl'), {
    ssr: false,
});

export default MapZoneView;
