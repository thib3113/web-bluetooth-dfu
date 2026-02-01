/*
 * Browser Entry Point (IIFE)
 * Handles global window attachment for script tag usage.
 */

import { SecureDfu } from "./secure-dfu";
import { SecureDfuPackage } from "./package";

// Force attachment to window
(window as any).SecureDfu = SecureDfu;
(window as any).SecureDfuPackage = SecureDfuPackage;

console.log("SecureDfu loaded globally.");