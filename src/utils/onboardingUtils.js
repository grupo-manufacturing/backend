function isManufacturerOnboardingComplete(profile) {
  if (!profile) return false;

  const hasUnitName = Boolean(profile.unit_name && String(profile.unit_name).trim());
  const hasBusinessType = Boolean(profile.business_type && String(profile.business_type).trim());
  const hasGstNumber = Boolean(profile.gst_number && String(profile.gst_number).trim());
  const hasPanNumber = Boolean(profile.pan_number && String(profile.pan_number).trim());
  const hasProductTypes = Array.isArray(profile.product_types) && profile.product_types.length > 0;
  const hasDailyCapacity = Number(profile.daily_capacity || 0) > 0;

  return hasUnitName && hasBusinessType && hasGstNumber && hasPanNumber && hasProductTypes && hasDailyCapacity;
}

module.exports = {
  isManufacturerOnboardingComplete
};
