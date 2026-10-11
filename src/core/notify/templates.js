/**
 * SMS templates. In India every commercial SMS must use a DLT-registered template; `dltId` is
 * filled per hospital when its templates are approved (go-live checklist).
 */
export const SMS_TEMPLATES = Object.freeze({
  SIGNUP_OTP: {
    dltId: '',
    text: {
      en: '{code} is your code to start a free trial of HMS Cloud. It expires in 5 minutes.',
      hi: 'HMS Cloud का मुफ़्त ट्रायल शुरू करने के लिए आपका कोड {code} है। यह 5 मिनट में समाप्त होगा।',
    },
  },
  PATIENT_WELCOME: {
    dltId: '',
    text: {
      en: 'Welcome to {hospital}. Your patient ID (UHID) is {uhid}. Please quote it at every visit.',
      hi: '{hospital} में आपका स्वागत है। आपकी पेशेंट आईडी (UHID) {uhid} है। हर बार आते समय इसे बताएँ।',
    },
  },
  USER_INVITE: {
    dltId: '',
    text: {
      en: '{hospital} has created your staff login ({username}). Set your password within 72 hours: {link}',
      hi: '{hospital} ने आपका स्टाफ़ लॉगिन ({username}) बनाया है। 72 घंटे के अंदर पासवर्ड सेट करें: {link}',
    },
  },
  PASSWORD_RESET_OTP: {
    dltId: '',
    text: {
      en: '{code} is your password reset code for {hospital}. It expires in 5 minutes. If you did not ask for it, tell your admin.',
      hi: '{hospital} में पासवर्ड बदलने के लिए आपका कोड {code} है। यह 5 मिनट में समाप्त होगा। अगर आपने यह नहीं माँगा, तो अपने एडमिन को बताएँ।',
    },
  },
  OPD_BOOKED: {
    dltId: '',
    text: {
      en: '{hospital}: your appointment with {doctor} is booked for {date} at {time}. Booking {apptNo}.',
      hi: '{hospital}: {doctor} के साथ आपका अपॉइंटमेंट {date} को {time} बजे बुक है। बुकिंग {apptNo}।',
    },
  },
  OPD_TOKEN_CALLED: {
    dltId: '',
    text: {
      en: '{hospital}: token {token}, please go to room {room} now.',
      hi: '{hospital}: टोकन {token}, कृपया अभी कमरा {room} में जाएँ।',
    },
  },
  LAB_REPORT_READY: {
    dltId: '',
    text: {
      en: '{hospital}: your {test} report ({orderNo}) is ready. Collect it at the lab or ask your doctor.',
      hi: '{hospital}: आपकी {test} रिपोर्ट ({orderNo}) तैयार है। लैब से लें या अपने डॉक्टर से पूछें।',
    },
  },
  LAB_SAMPLE_REJECTED: {
    dltId: '',
    text: {
      en: '{hospital}: your sample for {tests} could not be tested ({reason}). Please give a new sample at the lab.',
      hi: '{hospital}: {tests} के लिए आपका सैंपल जाँचा नहीं जा सका ({reason})। कृपया लैब में नया सैंपल दें।',
    },
  },
  RAD_SCHEDULED: {
    dltId: '',
    text: {
      en: '{hospital}: your {study} is booked for {time} at {room}. {prep}',
      hi: '{hospital}: आपका {study} {time} पर {room} में बुक है। {prep}',
    },
  },
  RAD_REPORT_READY: {
    dltId: '',
    text: {
      en: '{hospital}: your {study} report ({accessionNo}) is ready. Collect it at radiology or ask your doctor.',
      hi: '{hospital}: आपकी {study} रिपोर्ट ({accessionNo}) तैयार है। रेडियोलॉजी से लें या अपने डॉक्टर से पूछें।',
    },
  },
  FEEDBACK_REQUEST: {
    dltId: '',
    text: {
      en: '{hospital}: how was your visit? Please rate us in one minute: {link}',
      hi: '{hospital}: आपका अनुभव कैसा रहा? एक मिनट में रेटिंग दें: {link}',
    },
  },
  COMPLAINT_CLOSED: {
    dltId: '',
    text: {
      en: '{hospital}: your complaint {complaintNo} has been resolved and closed. Thank you for telling us.',
      hi: '{hospital}: आपकी शिकायत {complaintNo} का समाधान कर बंद कर दिया गया है। हमें बताने के लिए धन्यवाद।',
    },
  },
  CAMPAIGN: {
    dltId: '',
    text: {
      en: '{hospital}: {text}',
      hi: '{hospital}: {text}',
    },
  },
  LOGIN_OTP: {
    dltId: '',
    text: {
      en: '{code} is your sign-in code for {hospital}. It expires in 5 minutes. Do not share it.',
      hi: '{hospital} में साइन-इन के लिए आपका कोड {code} है। यह 5 मिनट में समाप्त होगा। इसे किसी से साझा न करें।',
    },
  },
});

export function renderTemplate(template, lang, vars) {
  const text = template.text[lang] ?? template.text.en;
  return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}
