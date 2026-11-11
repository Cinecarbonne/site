/* Le carnet collectif ne reprend pas les notes personnelles du carnet d’origine. */
window.CarnetNotes=function(ids,onChange,onStatus){return {editable:false,start(){onChange({});onStatus('Carnet du groupe · avis dans l’espace de vote');},scores(){return {};},set(){},apply(){}};};
