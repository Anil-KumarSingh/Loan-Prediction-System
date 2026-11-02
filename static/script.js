/* =========================================================
   LoanPredict AI — script.js
   Handles: navigation, validation, prediction request, UI states
   ========================================================= */

// ---------- Navbar scroll + mobile toggle ----------
const navbar = document.getElementById('navbar');
const navToggle = document.getElementById('navToggle');
const navLinks = document.getElementById('navLinks');

window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 10);
});

navToggle.addEventListener('click', () => {
  navToggle.classList.toggle('open');
  navLinks.classList.toggle('open');
});

// Close mobile menu + set active link when a nav link is clicked
document.querySelectorAll('.nav-link').forEach((link) => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach((l) => l.classList.remove('active'));
    link.classList.add('active');
    navToggle.classList.remove('open');
    navLinks.classList.remove('open');
  });
});

// ---------- Scroll reveal for About cards ----------
const revealTargets = document.querySelectorAll('.about-card');
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.style.animationPlayState = 'running';
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.15 }
);
revealTargets.forEach((el) => observer.observe(el));

// ---------- Button ripple effect ----------
document.querySelectorAll('.ripple').forEach((btn) => {
  btn.addEventListener('click', function (e) {
    const circle = document.createElement('span');
    const diameter = Math.max(this.clientWidth, this.clientHeight);
    const radius = diameter / 2;

    circle.style.width = circle.style.height = `${diameter}px`;
    circle.style.left = `${e.clientX - this.getBoundingClientRect().left - radius}px`;
    circle.style.top = `${e.clientY - this.getBoundingClientRect().top - radius}px`;
    circle.classList.add('ripple-circle');

    const existingRipple = this.querySelector('.ripple-circle');
    if (existingRipple) existingRipple.remove();

    this.appendChild(circle);
    setTimeout(() => circle.remove(), 600);
  });
});

// ---------- Form elements ----------
const form = document.getElementById('predictionForm');
const predictBtn = document.getElementById('predictBtn');
const resetBtn = document.getElementById('resetBtn');
const loadingState = document.getElementById('loadingState');
const resultCard = document.getElementById('resultCard');
const resultIcon = document.getElementById('resultIcon');
const resultTitle = document.getElementById('resultTitle');
const resultText = document.getElementById('resultText');
const tryAgainBtn = document.getElementById('tryAgainBtn');
const bankResults = document.getElementById('bankResults');
const bankResultsTitle = document.getElementById('bankResultsTitle');
const bankResultsNote = document.getElementById('bankResultsNote');
const bankList = document.getElementById('bankList');
const progressBar = document.getElementById('progressBar');
const progressLabel = document.getElementById('progressLabel');
const scoreMeterFill = document.getElementById('scoreMeterFill');
const scoreMeterLabel = document.getElementById('scoreMeterLabel');
const estimateRate = document.getElementById('estimateRate');
const rateValue = document.getElementById('rateValue');
const emiValue = document.getElementById('emiValue');
const totalRepaymentValue = document.getElementById('totalRepaymentValue');
const interestValue = document.getElementById('interestValue');

// Field configuration: id -> validation rule
const fieldRules = {
  applicantIncome: (v) => v !== '' && Number(v) >= 0,
  coapplicantIncome: (v) => v !== '' && Number(v) >= 0,
  loanAmount: (v) => v !== '' && Number(v) > 0,
  loanTerm: (v) => v !== '' && Number(v) > 0,
  creditScore: (v) => v !== '' && Number(v) >= 300 && Number(v) <= 900,
  dtiRatio: (v) => v !== '' && Number(v) >= 0 && Number(v) <= 100,
  age: (v) => v !== '' && Number(v) >= 18 && Number(v) <= 100,
  gender: (v) => v !== '',
  maritalStatus: (v) => v !== '',
  education: (v) => v !== '',
  employmentStatus: (v) => v !== '',
  employerCategory: (v) => v !== '',
  propertyArea: (v) => v !== '',
  loanPurpose: (v) => v !== '',
  dependents: (v) => v !== '' && Number(v) >= 0,
  existingLoans: (v) => v !== '' && Number(v) >= 0,
  savings: (v) => v !== '' && Number(v) >= 0,
};

const errorMessages = {
  applicantIncome: 'Enter a valid applicant income',
  coapplicantIncome: 'Enter a valid coapplicant income (0 if none)',
  loanAmount: 'Enter a valid loan amount',
  loanTerm: 'Enter a valid loan term',
  creditScore: 'Credit score must be between 300 and 900',
  dtiRatio: 'DTI ratio must be between 0 and 100',
  age: 'Age must be between 18 and 100',
  gender: 'Please select a gender',
  maritalStatus: 'Please select a marital status',
  education: 'Please select an education level',
  employmentStatus: 'Please select an employment status',
  employerCategory: 'Please select an employer category',
  propertyArea: 'Please select a property area',
  loanPurpose: 'Please select a loan purpose',
  dependents: 'Enter a valid number of dependents',
  existingLoans: 'Enter a valid number of existing loans',
  savings: 'Enter a valid savings amount',
};

// Validate a single field and show/hide its error message
function validateField(id) {
  const field = document.getElementById(id);
  const errorEl = document.getElementById(`err-${id}`);
  const isValid = fieldRules[id](field.value);

  if (isValid) {
    field.classList.remove('invalid');
    errorEl.textContent = '';
  } else {
    field.classList.add('invalid');
    errorEl.textContent = errorMessages[id];
  }

  return isValid;
}

// Validate on blur/change for real-time feedback
Object.keys(fieldRules).forEach((id) => {
  const field = document.getElementById(id);
  field.addEventListener('blur', () => validateField(id));
  field.addEventListener('change', () => validateField(id));
  field.addEventListener('input', updateFormInsights);
  field.addEventListener('change', updateFormInsights);
});

const formatINR = (amount) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0,
}).format(amount);

function updateFormInsights() {
  const completed = Object.keys(fieldRules).filter((id) => {
    const field = document.getElementById(id);
    return field && field.value !== '';
  }).length;
  const percent = Math.round((completed / Object.keys(fieldRules).length) * 100);
  progressBar.style.width = `${percent}%`;
  progressLabel.textContent = `${percent}% complete`;

  const score = Number(document.getElementById('creditScore').value);
  let scoreLabel = 'Enter a score from 300 to 900';
  if (score >= 300 && score <= 649) scoreLabel = 'Lower score range';
  else if (score <= 699 && score >= 650) scoreLabel = 'Fair score range';
  else if (score <= 749 && score >= 700) scoreLabel = 'Good score range';
  else if (score >= 750 && score <= 900) scoreLabel = 'Strong score range';
  scoreMeterLabel.textContent = scoreLabel;
  scoreMeterFill.style.width = score >= 300 && score <= 900 ? `${((score - 300) / 600) * 100}%` : '0%';
  scoreMeterFill.dataset.band = score >= 750 ? 'strong' : score >= 700 ? 'good' : score >= 650 ? 'fair' : 'low';

  const principal = Number(document.getElementById('loanAmount').value);
  const months = Number(document.getElementById('loanTerm').value);
  const annualRate = Number(estimateRate.value);
  rateValue.textContent = annualRate.toFixed(1);
  if (!principal || !months || principal <= 0 || months <= 0) {
    emiValue.textContent = '₹—';
    totalRepaymentValue.textContent = '₹—';
    interestValue.textContent = '₹—';
    return;
  }
  const monthlyRate = annualRate / 1200;
  const emi = principal * monthlyRate * ((1 + monthlyRate) ** months) / (((1 + monthlyRate) ** months) - 1);
  const total = emi * months;
  emiValue.textContent = formatINR(emi);
  totalRepaymentValue.textContent = formatINR(total);
  interestValue.textContent = formatINR(total - principal);
}

estimateRate.addEventListener('input', updateFormInsights);
updateFormInsights();

// Validate the whole form, returns true if all fields pass
function validateForm() {
  let allValid = true;
  Object.keys(fieldRules).forEach((id) => {
    const valid = validateField(id);
    if (!valid) allValid = false;
  });
  return allValid;
}

// Collect all form values into a JSON-ready object
function collectFormData() {
  return {
    applicant_income: Number(document.getElementById('applicantIncome').value),
    coapplicant_income: Number(document.getElementById('coapplicantIncome').value),
    loan_amount: Number(document.getElementById('loanAmount').value),
    loan_term: Number(document.getElementById('loanTerm').value),
    credit_score: Number(document.getElementById('creditScore').value),
    dti_ratio: Number(document.getElementById('dtiRatio').value),
    age: Number(document.getElementById('age').value),
    gender: document.getElementById('gender').value,
    marital_status: document.getElementById('maritalStatus').value,
    education: document.getElementById('education').value,
    employment_status: document.getElementById('employmentStatus').value,
    employer_category: document.getElementById('employerCategory').value,
    property_area: document.getElementById('propertyArea').value,
    loan_purpose: document.getElementById('loanPurpose').value,
    dependents: Number(document.getElementById('dependents').value),
    existing_loans: Number(document.getElementById('existingLoans').value),
    savings: Number(document.getElementById('savings').value),
  };
}

// Show the loading spinner and disable the submit button
function showLoading() {
  form.hidden = true;
  form.style.display = 'none';
  resultCard.hidden = true;
  resultCard.style.display = 'none';
  loadingState.hidden = false;
  loadingState.style.display = 'flex';
  predictBtn.disabled = true;
}

// Hide loading spinner
function hideLoading() {
  loadingState.hidden = true;
  loadingState.style.display = 'none';
}

// Render the result card based on the prediction outcome
function showResult(prediction, confidence, bankEligibility) {
  hideLoading();
  form.hidden = true;
  form.style.display = 'none';

  const approved = String(prediction).toLowerCase() === 'approved';

  resultIcon.className = `result-icon ${approved ? 'approved' : 'rejected'}`;
  resultIcon.innerHTML = approved
    ? `<svg width="34" height="34" viewBox="0 0 24 24" fill="none"><path d="M4 12.5l5 5L20 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : `<svg width="34" height="34" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  resultTitle.textContent = approved ? 'Loan Approved' : 'Loan Rejected';
  resultTitle.className = `result-title ${approved ? 'approved' : 'rejected'}`;

  const confidenceText =
    typeof confidence === 'number' ? ` (model confidence: ${confidence.toFixed(1)}%)` : '';

  resultText.textContent = approved
    ? `Congratulations! Based on the provided information, your loan has a high chance of approval.${confidenceText}`
    : `Based on the current details, the loan is likely to be rejected.${confidenceText}`;

  bankList.replaceChildren();
  if (bankEligibility) {
    bankResults.hidden = false;
    bankResultsTitle.textContent = bankEligibility.supported
      ? `${bankEligibility.count} bank${bankEligibility.count === 1 ? '' : 's'} match your credit score`
      : 'Bank credit score matches';
    bankResultsNote.textContent = bankEligibility.message;
    bankEligibility.banks.forEach((bank) => {
      const item = document.createElement('li');
      const name = document.createElement('strong');
      name.textContent = bank.name;
      const detail = document.createElement('p');
      detail.textContent = bank.summary;
      const source = document.createElement('a');
      source.href = bank.source;
      source.textContent = bank.source_label;
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      item.append(name, detail, source);
      bankList.appendChild(item);
    });
  } else {
    bankResults.hidden = true;
  }

  resultCard.hidden = false;
  resultCard.style.display = 'flex';
  predictBtn.disabled = false;
}

// ---------- Handle form submission ----------
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!validateForm()) return;

  const payload = collectFormData();
  showLoading();

  try {
    const apiUrl = (typeof window !== 'undefined' && window.API_URL) ? window.API_URL : '/predict';
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Server responded with status ${response.status}`);
    }

    const data = await response.json();
    hideLoading();
    showResult(data.prediction, data.confidence, data.bank_eligibility);
  } catch (error) {
    // Backend not reachable or returned an error — surface it clearly
    hideLoading();
    form.hidden = false;
    form.style.display = '';
    predictBtn.disabled = false;
    alert(
      'Could not reach the prediction server. Please make sure the Flask backend is running.'
    );
    console.error('Prediction request failed:', error);
  }
});

// ---------- Reset form ----------
resetBtn.addEventListener('click', () => {
  setTimeout(() => {
    Object.keys(fieldRules).forEach((id) => {
      document.getElementById(id).classList.remove('invalid');
      document.getElementById(`err-${id}`).textContent = '';
    });
    updateFormInsights();
  }, 0);
});

// ---------- Try another application ----------
tryAgainBtn.addEventListener('click', () => {
  resultCard.hidden = true;
  resultCard.style.display = 'none';
  loadingState.hidden = true;
  loadingState.style.display = 'none';
  form.hidden = false;
  form.style.display = '';
  form.reset();
  updateFormInsights();
  Object.keys(fieldRules).forEach((id) => {
    document.getElementById(id).classList.remove('invalid');
    document.getElementById(`err-${id}`).textContent = '';
  });
});

// ---------- Example Application Profiles ----------
const presetProfiles = {
  strong: {
    applicantIncome: 85000,
    coapplicantIncome: 25000,
    loanAmount: 200000,
    loanTerm: 36,
    creditScore: 780,
    dtiRatio: 20,
    age: 35,
    gender: 'Male',
    maritalStatus: 'Married',
    education: 'Graduate',
    employmentStatus: 'Salaried',
    employerCategory: 'Government',
    propertyArea: 'Urban',
    loanPurpose: 'Home',
    dependents: 1,
    existingLoans: 0,
    savings: 60000,
  },
  moderate: {
    applicantIncome: 45000,
    coapplicantIncome: 10000,
    loanAmount: 150000,
    loanTerm: 48,
    creditScore: 650,
    dtiRatio: 38,
    age: 29,
    gender: 'Male',
    maritalStatus: 'Single',
    education: 'Graduate',
    employmentStatus: 'Salaried',
    employerCategory: 'Private',
    propertyArea: 'Semiurban',
    loanPurpose: 'Car',
    dependents: 2,
    existingLoans: 1,
    savings: 15000,
  },
  high_risk: {
    applicantIncome: 1500,
    coapplicantIncome: 0,
    loanAmount: 400000,
    loanTerm: 12,
    creditScore: 340,
    dtiRatio: 85,
    age: 21,
    gender: 'Female',
    maritalStatus: 'Single',
    education: 'Not Graduate',
    employmentStatus: 'Unemployed',
    employerCategory: 'Unemployed',
    propertyArea: 'Rural',
    loanPurpose: 'Personal',
    dependents: 4,
    existingLoans: 6,
    savings: 500,
  },
};

document.querySelectorAll('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.getAttribute('data-preset');
    const profile = presetProfiles[key];
    if (!profile) return;

    // Reset result view if active and show form
    resultCard.hidden = true;
    resultCard.style.display = 'none';
    loadingState.hidden = true;
    loadingState.style.display = 'none';
    form.hidden = false;
    form.style.display = '';

    // Populate all form fields
    Object.keys(profile).forEach((fieldId) => {
      const input = document.getElementById(fieldId);
      if (input) {
        input.value = profile[fieldId];
        validateField(fieldId);
      }
    });
    updateFormInsights();

    // Smooth scroll to form card for quick review
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});
