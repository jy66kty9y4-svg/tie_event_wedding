export const SIDEBAR_MIN=72,SIDEBAR_DEFAULT=240,SIDEBAR_MAX=320;
export function sidebarMax(viewport){return Math.max(SIDEBAR_MIN,Math.min(SIDEBAR_MAX,viewport-440))}
export function clampSidebarWidth(width,viewport){return Math.round(Math.max(SIDEBAR_MIN,Math.min(sidebarMax(viewport),Number.isFinite(width)?width:SIDEBAR_MIN)))}
