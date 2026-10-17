
import { useEffect, useMemo, useState } from "react";
import {
  getTransactions,
  saveTransaction,
  saveTransactions,
  deleteSavedTransaction,
  getBudgetSettings,
  saveBudgetSettings,
} from "./db";
import { extractTextFromImage, parseBillText } from "./ocr";
import "./App.css";

const initialTransactions = [
  { id: 1, vendor: "Amazon India", date: "12 Apr 2026", amount: 2499, category: "Shopping", type: "Invoice" },
  { id: 2, vendor: "Zomato", date: "10 Apr 2026", amount: 1240, category: "Food", type: "Receipt" },
  { id: 3, vendor: "Uber", date: "08 Apr 2026", amount: 850, category: "Travel", type: "Receipt" },
  { id: 4, vendor: "Google Cloud", date: "05 Apr 2026", amount: 3999, category: "Software", type: "Invoice" },
  { id: 5, vendor: "Cafe Coffee Day", date: "03 Apr 2026", amount: 620, category: "Food", type: "Receipt" },
  { id: 6, vendor: "Tata Motors", date: "28 Mar 2026", amount: 12500, category: "Travel", type: "Invoice" },
  { id: 7, vendor: "Local Store", date: "25 Mar 2026", amount: 430, category: "Shopping", type: "Receipt" },
  { id: 8, vendor: "Swiggy", date: "22 Mar 2026", amount: 890, category: "Food", type: "Receipt" },
];

const categories = [
  { name: "Food", color: "#e9a23b" },
  { name: "Travel", color: "#5aa984" },
  { name: "Software", color: "#6498dc" },
  { name: "Shopping", color: "#a68ae5" },
];

const money = (amount) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
  
function getTransactionDate(dateValue) {
  if (!dateValue) return null;
  const value = String(dateValue);

  // Handles dates from the transaction form: YYYY-MM-DD
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    return parsed.getFullYear() === Number(year) &&
      parsed.getMonth() === Number(month) - 1 &&
      parsed.getDate() === Number(day)
      ? parsed
      : null;
  }

  // Handles existing demo dates such as "12 Apr 2026"
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const textDateMatch = value.match(/^(\d{1,2})\s+[A-Za-z]{3}\s+\d{4}$/);
  if (textDateMatch && parsed.getDate() !== Number(textDateMatch[1])) return null;
  return parsed;
}

function getDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function getMonthKey(date) {
  return `${date.getFullYear()}-${String(
    date.getMonth() + 1
  ).padStart(2, "0")}`;
}

function isExpenseTransaction(item) {
  if (item?.amount === "" || item?.amount === null || item?.amount === undefined) {
    return false;
  }
  const amount = Number(item?.amount);
  const type = String(item?.type || "").toLowerCase();
  const category = String(item?.category || "").toLowerCase();

  return (
    Number.isFinite(amount) &&
    amount >= 0 &&
    type !== "income" &&
    category !== "income" &&
    item?.isIncome !== true
  );
}

function formatMonth(date) {
  return date.toLocaleDateString("en-IN", {
    month: "short",
    year: "2-digit",
  });
}

function getRecurringExpenses(items) {
  const vendors = new Map();

  items.forEach((item) => {
    const vendor = String(item.vendor || "").trim();
    const date = getTransactionDate(item.date);
    const amount = Number(item.amount);
    if (!vendor || !date || !isExpenseTransaction(item) || amount <= 0) return;

    const key = vendor.toLocaleLowerCase();
    const entries = vendors.get(key) || { vendor, transactions: [] };
    entries.transactions.push({ date, amount });
    vendors.set(key, entries);
  });

  return [...vendors.values()].flatMap(({ vendor, transactions: entries }) => {
    if (entries.length < 3) return [];

    entries.sort((first, second) => first.date - second.date);
    const intervals = entries.slice(1).map((entry, index) =>
      (entry.date - entries[index].date) / 86400000
    );
    const averageInterval =
      intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    const consistent = intervals.every(
      (interval) => Math.abs(interval - averageInterval) <= Math.max(8, averageInterval * 0.25)
    );
    const frequency =
      averageInterval >= 5 && averageInterval <= 9
        ? "Weekly"
        : averageInterval >= 12 && averageInterval <= 17
          ? "Every two weeks"
          : averageInterval >= 20 && averageInterval <= 40
            ? "Monthly"
            : averageInterval >= 75 && averageInterval <= 105
              ? "Quarterly"
              : null;

    if (!consistent || !frequency) return [];

    const latest = entries[entries.length - 1];
    const nextDate = new Date(latest.date);
    nextDate.setDate(nextDate.getDate() + Math.round(averageInterval));

    return [{
      vendor,
      frequency,
      averageAmount:
        entries.reduce((sum, entry) => sum + entry.amount, 0) / entries.length,
      nextDate,
    }];
  });
}

function MonthlyChart({ months, compact = false }) {
  const maxAmount = Math.max(1, ...months.map((month) => month.amount));

  return (
    <div className={`monthly-chart${compact ? " compact-chart" : ""}`}>
      {months.map((month) => (
        <div className="month-column" key={month.key}>
          <span className="month-value">
            {month.amount >= 1000
              ? `₹${(month.amount / 1000).toFixed(1)}k`
              : `₹${Math.round(month.amount)}`}
          </span>
          <div className="month-bar-track">
            <div
              className={`month-bar ${
                month.key === getMonthKey(new Date()) ? "current-month-bar" : ""
              }`}
              style={{ height: `${(month.amount / maxAmount) * 100}%` }}
              title={`${month.label}: ₹${month.amount.toLocaleString("en-IN")}`}
            />
          </div>
          <span className="month-label">{month.label}</span>
        </div>
      ))}
    </div>
  );
}


function App() {
  const [transactions, setTransactions] = useState([]);
const [isLoading, setIsLoading] = useState(true);
const [dbError, setDbError] = useState("");
  const [budgetError, setBudgetError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [documentType, setDocumentType] = useState("All");
  const [sortOrder, setSortOrder] = useState("newest");
  const [budgetSettings, setBudgetSettings] = useState({
    overall: "",
    categories: {},
  });
  const [budgetMonth, setBudgetMonth] = useState(getMonthKey(new Date()));
  const [savingsReduction, setSavingsReduction] = useState(10);
  const [exportStartDate, setExportStartDate] = useState("");
  const [exportEndDate, setExportEndDate] = useState("");
  const [exportError, setExportError] = useState("");
  const [activePage, setActivePage] = useState("Dashboard");
  const [message, setMessage] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [showTransactionForm, setShowTransactionForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [isProcessingOCR, setIsProcessingOCR] = useState(false);
const [ocrProgress, setOcrProgress] = useState(0);

   const [formData, setFormData] = useState({
  vendor: "",
  date: new Date().toISOString().slice(0, 10),
  amount: "",
  category: "Food",
  type: "Receipt",
  });

useEffect(() => {
  let cancelled = false;

  async function loadData() {
    try {
      let saved = await getTransactions();

      // Seed the demo data only on the first run.
      if (saved.length === 0) {
        await saveTransactions(initialTransactions);
        saved = initialTransactions;
      }

      if (!cancelled) {
        setTransactions(saved);
        setDbError("");
      }
    } catch (error) {
      console.error("Could not load BillBuddy data:", error);

      if (!cancelled) {
        setDbError(
          "Could not access local storage. Check browser storage settings."
        );
      }
    } finally {
      if (!cancelled) setIsLoading(false);
    }
  }

  loadData();

  return () => {
    cancelled = true;
  };
}, []);

useEffect(() => {
  let cancelled = false;

  getBudgetSettings()
    .then((settings) => {
      if (!cancelled && settings) {
        setBudgetSettings({
          overall: settings.overall ?? "",
          categories: settings.categories || {},
        });
      }
    })
    .catch((error) => {
      console.error("Could not load budget settings:", error);
      if (!cancelled) setBudgetError("Could not load saved budget settings.");
    });

  return () => {
    cancelled = true;
  };
}, []);

  const categoryTotals = categories.map((item) => ({
    ...item,
    amount: transactions
      .filter((transaction) => transaction.category === item.name)
      .reduce((sum, transaction) => sum + (Number(transaction.amount) || 0), 0),
  }));
  const categoryTotal = categoryTotals.reduce((sum, item) => sum + item.amount, 0);

  const dateRangeError = startDate && endDate && startDate > endDate;

  const filtered = useMemo(() => {
    const minimum = minAmount === "" ? null : Number(minAmount);
    const maximum = maxAmount === "" ? null : Number(maxAmount);
    const matches = transactions.filter((item) => {
      const matchesSearch =
        String(item.vendor || "").toLowerCase().includes(search.toLowerCase()) ||
        String(item.category || "").toLowerCase().includes(search.toLowerCase());

      const matchesCategory =
        category === "All" || item.category === category;

      const transactionDate = getTransactionDate(item.date);
      const transactionDateKey = transactionDate
        ? getDateKey(transactionDate)
        : null;
      const matchesDate =
        !dateRangeError &&
        (!startDate || (transactionDateKey && transactionDateKey >= startDate)) &&
        (!endDate || (transactionDateKey && transactionDateKey <= endDate));
      const amount = Number(item.amount);
      const matchesAmount =
        Number.isFinite(amount) &&
        (minimum === null || amount >= minimum) &&
        (maximum === null || amount <= maximum);
      const matchesType =
        documentType === "All" || item.type === documentType;

      return (
        matchesSearch &&
        matchesCategory &&
        matchesDate &&
        matchesAmount &&
        matchesType
      );
    });

    return matches.sort((first, second) => {
      if (sortOrder === "amount-ascending") {
        return Number(first.amount) - Number(second.amount);
      }
      if (sortOrder === "amount-descending") {
        return Number(second.amount) - Number(first.amount);
      }

      const firstDate = getTransactionDate(first.date)?.getTime() ?? null;
      const secondDate = getTransactionDate(second.date)?.getTime() ?? null;

      if (firstDate === null) return secondDate === null ? 0 : 1;
      if (secondDate === null) return -1;
      return sortOrder === "oldest" ? firstDate - secondDate : secondDate - firstDate;
    });
  }, [
    transactions,
    search,
    category,
    startDate,
    endDate,
    minAmount,
    maxAmount,
    documentType,
    sortOrder,
    dateRangeError,
  ]);

  function clearFilters() {
    setSearch("");
    setCategory("All");
    setStartDate("");
    setEndDate("");
    setMinAmount("");
    setMaxAmount("");
    setDocumentType("All");
    setSortOrder("newest");
  }

  function exportCSV(start = "", end = "") {
    const header = ["Vendor", "Date", "Amount (INR)", "Category", "Type"];
    const rows = transactions.filter((item) => {
      const date = getTransactionDate(item.date);
      const dateKey = date ? getDateKey(date) : null;
      return (!start || (dateKey && dateKey >= start)) &&
        (!end || (dateKey && dateKey <= end));
    }).map((item) => [
      item.vendor,
      item.date,
      item.amount,
      item.category,
      item.type,
    ]);

    const csv = [header, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");

    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "billbuddy-transactions.csv";
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Your CSV export has started.");
  }

const monthlyAnalytics = useMemo(() => {
  const now = new Date();

  // Current month and previous five months.
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(
      now.getFullYear(),
      now.getMonth() - 5 + index,
      1
    );

    return {
      key: getMonthKey(date),
      label: formatMonth(date),
      amount: 0,
    };
  });

  const monthlyMap = new Map(
    months.map((month) => [month.key, month])
  );

  const categoryTotals = {};

  transactions.forEach((item) => {
    const date = getTransactionDate(item.date);
    const amount = Number(item.amount);

    if (!date || !isExpenseTransaction(item)) return;

    const key = getMonthKey(date);
    const month = monthlyMap.get(key);

    if (month) {
      month.amount += amount;
    }

    // Current month's category breakdown.
    if (key === getMonthKey(now)) {
      const category = item.category || "Other";
      categoryTotals[category] =
        (categoryTotals[category] || 0) + amount;
    }
  });

  const currentKey = getMonthKey(now);
  const previousDate = new Date(
    now.getFullYear(),
    now.getMonth() - 1,
    1
  );
  const previousKey = getMonthKey(previousDate);

 const currentMonth = monthlyMap.get(currentKey)?.amount || 0;
const previousMonth = monthlyMap.get(previousKey)?.amount || 0;

  const change =
    previousMonth === 0
      ? null
      : ((currentMonth - previousMonth) / previousMonth) * 100;

  return {
    months,
    currentMonth,
    previousMonth,
    change,
    categoryTotals,
    maxAmount: Math.max(1, ...months.map((month) => month.amount)),
  };
}, [transactions]);

const now = new Date();
const currentMonthKey = getMonthKey(now);
const todayKey = getDateKey(now);
const currentDay = now.getDate();
const daysInCurrentMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
const previousMonthKey = getMonthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
const insightsData = useMemo(() => {
  const currentExpenses = transactions.filter((item) => {
    const date = getTransactionDate(item.date);
    return isExpenseTransaction(item) && date &&
      getMonthKey(date) === currentMonthKey && getDateKey(date) <= todayKey;
  });
  const currentMonthExpenses = currentExpenses.reduce(
    (sum, item) => sum + Number(item.amount),
    0
  );
  const currentCategorySpending = currentExpenses.reduce((totals, item) => {
    const name = String(item.category || "Other");
    totals[name] = (totals[name] || 0) + Number(item.amount);
    return totals;
  }, {});

  const budgetAlerts = [];
  const overallLimit = Number(budgetSettings.overall);
  if (Number.isFinite(overallLimit) && overallLimit > 0) {
    const percent = currentMonthExpenses / overallLimit * 100;
    if (percent >= 80) {
      budgetAlerts.push({
        key: "overall",
        name: "Overall monthly budget",
        limit: overallLimit,
        spent: currentMonthExpenses,
        percent,
        remaining: overallLimit - currentMonthExpenses,
        severity: percent > 100 ? "critical" : "warning",
      });
    }
  }

  Object.entries(budgetSettings.categories || {}).forEach(([name, rawLimit]) => {
    const limit = Number(rawLimit);
    const spent = currentCategorySpending[name] || 0;
    if (!Number.isFinite(limit) || limit <= 0) return;

    const percent = spent / limit * 100;
    if (percent >= 80) {
      budgetAlerts.push({
        key: `category-${name}`,
        name,
        limit,
        spent,
        percent,
        remaining: limit - spent,
        severity: percent > 100 ? "critical" : "warning",
      });
    }
  });

  const unusualExpenses = transactions.flatMap((item) => {
    const date = getTransactionDate(item.date);
    const amount = Number(item.amount);
    if (
      !date ||
      getDateKey(date) > todayKey ||
      !isExpenseTransaction(item) ||
      amount <= 0
    ) return [];

    const history = transactions.filter((candidate) => {
      const historyDate = getTransactionDate(candidate.date);
      return candidate.id !== item.id &&
        isExpenseTransaction(candidate) &&
        historyDate &&
        getDateKey(historyDate) < getDateKey(date);
    }).map((candidate) => Number(candidate.amount));

    if (history.length < 5) return [];

    const mean = history.reduce((sum, value) => sum + value, 0) / history.length;
    const variance = history.reduce((sum, value) => sum + (value - mean) ** 2, 0) / history.length;
    const threshold = mean + 2 * Math.sqrt(variance);
    if (amount <= threshold) return [];

    return [{
      key: String(item.id),
      description: String(item.vendor || item.description || "Unnamed transaction"),
      amount,
      date,
      historicalCount: history.length,
      historicalMean: mean,
      threshold,
    }];
  }).sort((first, second) => second.date - first.date);

  const previousCategorySpending = transactions.reduce((totals, item) => {
    const date = getTransactionDate(item.date);
    if (!date || getMonthKey(date) !== previousMonthKey || !isExpenseTransaction(item)) {
      return totals;
    }

    const name = String(item.category || "Other");
    totals[name] = (totals[name] || 0) + Number(item.amount);
    return totals;
  }, {});

  const recommendations = new Map();
  const topCategory = Object.entries(currentCategorySpending)
    .sort((first, second) => second[1] - first[1])[0];

  if (topCategory?.[1] > 0) {
    recommendations.set(topCategory[0], [
      `${topCategory[0]} is the highest-spending category so far this month.`,
    ]);
  }

  Object.entries(currentCategorySpending).forEach(([name, spent]) => {
    const limit = Number(budgetSettings.categories?.[name]);
    if (!Number.isFinite(limit) || limit <= 0) return;

    const remaining = limit - spent;
    if (remaining <= limit * 0.2) {
      const reasons = recommendations.get(name) || [];
      reasons.push(
        remaining < 0
          ? `Spending is ${money(Math.abs(remaining))} over its category budget; reducing by at least this amount would bring it back within budget.`
          : `Only ${money(remaining)} remains in its category budget.`
      );
      recommendations.set(name, reasons);
    }
  });

  Object.entries(currentCategorySpending).forEach(([name, spent]) => {
    const previous = previousCategorySpending[name] || 0;
    if (previous > 0 && spent > previous) {
      const reasons = recommendations.get(name) || [];
      reasons.push(`Spending increased by ${money(spent - previous)} from last month.`);
      recommendations.set(name, reasons);
    }
  });

  const projectedSpending = currentMonthExpenses === 0
    ? 0
    : currentMonthExpenses / currentDay * daysInCurrentMonth;
  const overallBudget = Number(budgetSettings.overall);

  return {
    currentMonthExpenses,
    budgetAlerts,
    unusualExpenses,
    recommendations: [...recommendations].map(([name, reasons]) => ({
      name,
      reasons,
      currentSpend: currentCategorySpending[name] || 0,
      estimatedSavings:
        (currentCategorySpending[name] || 0) * savingsReduction / 100,
    })),
    projectedSpending,
    daysInMonth: daysInCurrentMonth,
    elapsedDays: currentDay,
    remainingBudget:
      Number.isFinite(overallBudget) && overallBudget > 0
        ? overallBudget - currentMonthExpenses
        : null,
  };
}, [transactions, budgetSettings, currentMonthKey, previousMonthKey, todayKey, currentDay, daysInCurrentMonth, savingsReduction]);
const currentMonthExpenses = insightsData.currentMonthExpenses;

const largestExpense = transactions.filter(isExpenseTransaction).reduce((largest, item) => {
  const amount = Number(item.amount);
  return amount > (Number(largest?.amount) || 0)
    ? item
    : largest;
}, null);
const highestCategory = [...categoryTotals].sort((first, second) => second.amount - first.amount)[0];
const categoryBreakdown = categoryTotals
  .filter((item) => item.amount > 0)
  .sort((first, second) => second.amount - first.amount);
const recurringExpenses = getRecurringExpenses(transactions);
const budgetMonthTransactions = transactions.filter((item) => {
  const date = getTransactionDate(item.date);
  return date && getMonthKey(date) === budgetMonth && isExpenseTransaction(item);
});
const budgetCategorySpending = categories.reduce((totals, item) => {
  totals[item.name] = budgetMonthTransactions
    .filter((transaction) => transaction.category === item.name)
    .reduce((sum, transaction) => sum + Math.max(0, Number(transaction.amount) || 0), 0);
  return totals;
}, {});
const budgetTotalSpending = budgetMonthTransactions.reduce(
  (sum, item) => sum + Math.max(0, Number(item.amount) || 0),
  0
);
const budgetExportCount = transactions.filter((item) => {
  const date = getTransactionDate(item.date);
  const dateKey = date ? getDateKey(date) : null;
  return (!exportStartDate || (dateKey && dateKey >= exportStartDate)) &&
    (!exportEndDate || (dateKey && dateKey <= exportEndDate));
}).length;

async function persistBudgetSettings() {
  const amounts = [budgetSettings.overall, ...Object.values(budgetSettings.categories)];
  const hasInvalidAmount = amounts.some((amount) =>
    amount !== "" && (!Number.isFinite(Number(amount)) || Number(amount) < 0)
  );
  if (hasInvalidAmount) {
    setBudgetError("Budget limits must be non-negative amounts.");
    return;
  }

  try {
    await saveBudgetSettings(budgetSettings);
    setBudgetError("");
    setMessage("Budget settings saved.");
  } catch (error) {
    console.error("Could not save budget settings:", error);
    setBudgetError("Could not save budget settings. Please try again.");
  }
}

function exportDateRange() {
  if (exportStartDate && exportEndDate && exportStartDate > exportEndDate) {
    setExportError("Start date must be on or before end date.");
    return;
  }
  setExportError("");
  exportCSV(exportStartDate, exportEndDate);
}

async function handleFiles(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  const file = files[0];

  if (!file.type.startsWith("image/")) {
    setMessage("Please upload a JPG or PNG image for OCR. PDF support comes next.");
    event.target.value = "";
    return;
  }

  setIsProcessingOCR(true);
  setOcrProgress(0);
  setMessage("Reading your bill...");

  try {
    const text = await extractTextFromImage(file, setOcrProgress);
    const details = parseBillText(text);

    setFormData({
      vendor: details.vendor,
      date: details.date || new Date().toISOString().slice(0, 10),
      amount: details.amount ? String(details.amount) : "",
      category: "Shopping",
      type: "Receipt",
    });

    setEditingId(null);
    setShowUpload(false);
    setShowTransactionForm(true);

    setMessage(
      text.trim()
        ? "Please review the extracted details before saving."
        : "No text was detected. Enter the bill details manually."
    );
  } catch (error) {
    console.error("OCR failed:", error);
    setMessage("Could not read this image. Please enter the details manually.");
  } finally {
    setIsProcessingOCR(false);
    setOcrProgress(0);
    event.target.value = "";
  }
}


async function deleteTransaction(id) {
  try {
    await deleteSavedTransaction(id);

    setTransactions((previous) =>
      previous.filter((item) => item.id !== id)
    );

    setMessage("Transaction deleted.");
    setDbError("");
  } catch (error) {
    console.error("Could not delete transaction:", error);
    setMessage("Unable to delete this transaction. Please try again.");
  }
}

  function openAddForm() {
  setEditingId(null);
  setFormData({
    vendor: "",
    date: new Date().toISOString().slice(0, 10),
    amount: "",
    category: "Food",
    type: "Receipt",
  });
  setShowTransactionForm(true);
}

function openEditForm(item) {
  setEditingId(item.id);
  const date = getTransactionDate(item.date);

  setFormData({
    vendor: item.vendor || "",
    date: date ? getDateKey(date) : new Date().toISOString().slice(0, 10),
    amount: String(item.amount ?? ""),
    category: item.category || "Food",
    type: item.type || "Receipt",
  });

  setShowTransactionForm(true);
}

async function handleTransactionSubmit(event) {
  event.preventDefault();

  const amount = Number(formData.amount);

  if (!formData.vendor.trim() || !formData.date || formData.amount === "" ||
      !Number.isFinite(amount) || amount < 0) {
    setMessage("Please enter a valid vendor, date, and non-negative amount.");
    return;
  }

  const transaction = {
    ...formData,
    vendor: formData.vendor.trim(),
    amount,
    date: new Date(`${formData.date}T12:00:00`).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
  };

  
  try {
    if (editingId !== null) {
      const updated = {
        ...transactions.find((item) => item.id === editingId),
        ...transaction,
        id: editingId,
      };

      await saveTransaction(updated);

      setTransactions((previous) =>
        previous.map((item) =>
          item.id === editingId ? updated : item
        )
      );

      setMessage("Transaction updated and saved.");
    } else {
      const newTransaction = {
        id: Date.now(),
        ...transaction,
      };

      await saveTransaction(newTransaction);

      setTransactions((previous) => [
        newTransaction,
        ...previous,
      ]);

      setMessage("Transaction added and saved.");
    }

    setShowTransactionForm(false);
    setEditingId(null);
    setDbError("");
  } catch (error) {
    console.error("Could not save transaction:", error);
    setMessage("Unable to save the transaction. Please try again.");
  }
}


  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={() => setActivePage("Dashboard")}>
          <span className="brand-icon">✳</span>
          <span>Bill<span className="brand-light">Buddy</span></span>
        </a>

        <p className="nav-label">WORKSPACE</p>
        <nav className="navigation">
          {[
            ["Dashboard", "▦"],
            ["Documents", "▤"],
            ["Categories", "◈"],
            ["Budgets", "▣"],
            ["Insights", "⌁"],
            ["Export", "⇩"],
          ].map(([label, icon]) => (
            <button
              key={label}
              className={`nav-item ${activePage === label ? "active" : ""}`}
              onClick={() => setActivePage(label)}
            >
              <span className="nav-icon">{icon}</span>
              {label}
              {label === "Documents" && (
                <span className="nav-count">{transactions.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="privacy-card">
            <span className="privacy-icon">⌑</span>
            <strong>Your documents, your control.</strong>
            <p>This demo keeps transaction data in the current page session.</p>
          </div>
          <div className="profile">
            <div className="avatar">B</div>
            <div>
              <strong>BillBuddy User</strong>
              <span>Personal workspace</span>
            </div>
            <span className="profile-dots">···</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">Workspace <span>/</span> {activePage}</div>
          <div className="topbar-right">
            <span className="storage-badge"><span /> Local demo</span>
            <div className="avatar small-avatar">B</div>
          </div>
        </header>

        <div className="page-content">
          {dbError && (
  <div className="notice" role="alert">
    {dbError}
  </div>
)}
          {budgetError && (
            <div className="notice" role="alert">
              {budgetError}
            </div>
          )}

{isLoading && (
  <p className="loading-message">Loading your saved transactions...</p>
)}

          <section className="welcome-row">
            <div>
              <p className="eyebrow">BILLBUDDY / {activePage.toUpperCase()}</p>
              <h1>
                {activePage}
                <span className="wave"> ✳</span>
              </h1>
              <p className="subtitle">
                {activePage === "Dashboard"
                  ? "A clear view of your monthly spending."
                  : activePage === "Documents"
                    ? "Manage, search, and organize your receipts and invoices."
                    : activePage === "Budgets"
                      ? "Set monthly limits and track your spending."
                      : activePage === "Insights"
                        ? "Explore spending patterns based on your saved transactions."
                        : activePage === "Export"
                          ? "Download a CSV of all transactions or a selected date range."
                          : "Review your spending by category."}
              </p>
            </div>
            {(activePage === "Dashboard" || activePage === "Documents") && (
              <div className="welcome-actions">
  <button
    className="secondary-button"
    onClick={openAddForm}
  >
    + Add transaction
  </button>

  <button
    className="primary-button"
    onClick={() => setShowUpload(true)}
  >
    <span>＋</span> Upload document
  </button>
</div>
            )}
          </section>

          {message && (
            <div className="notice" role="status">
              <span>{message}</span>
              <button onClick={() => setMessage("")} aria-label="Dismiss message">×</button>
            </div>
          )}

          {activePage === "Dashboard" ? (
            <>
              <section className="stats-grid dashboard-stats">
                <article className="stat-card">
                  <div className="stat-top">
                    <span>Expenses this month</span>
                    <span className="stat-icon green">₹</span>
                  </div>
                  <h2>{money(currentMonthExpenses)}</h2>
                  <p className="stat-foot muted-foot">Based on dated transactions</p>
                </article>
                <article className="stat-card">
                  <div className="stat-top">
                    <span>Transactions</span>
                    <span className="stat-icon purple">▤</span>
                  </div>
                  <h2>{transactions.length}</h2>
                  <p className="stat-foot muted-foot">All saved records</p>
                </article>
                <article className="stat-card income-stat">
                  <div className="stat-top">
                    <span>Income</span>
                    <span className="stat-icon blue">↗</span>
                  </div>
                  <h2>Not tracked</h2>
                  <p className="stat-foot muted-foot">Transactions have no income field</p>
                </article>
              </section>

              <section className="analytics-panel dashboard-chart-panel">
                <div className="analytics-heading">
                  <div>
                    <h2>Monthly spending</h2>
                    <p>Six-month overview</p>
                  </div>
                  <span className="analytics-period">6 months</span>
                </div>
                {monthlyAnalytics.months.some((month) => month.amount > 0) ? (
                  <MonthlyChart months={monthlyAnalytics.months} compact />
                ) : (
                  <p className="analytics-empty">No spending in the last six months.</p>
                )}
              </section>

              <section className="dashboard-lower">
                <div className="panel recent-panel">
                  <div className="section-heading">
                    <div>
                      <h2>Recent transactions</h2>
                      <p>Your latest saved documents</p>
                    </div>
                    <button className="text-button" onClick={() => setActivePage("Documents")}>
                      View all documents <span>→</span>
                    </button>
                  </div>
                  <div className="recent-list">
                    {[...transactions]
                      .sort((first, second) =>
                        (getTransactionDate(second.date)?.getTime() ?? 0) -
                        (getTransactionDate(first.date)?.getTime() ?? 0)
                      )
                      .slice(0, 5)
                      .map((item) => (
                        <div className="recent-row" key={item.id}>
                          <span className="vendor-avatar">
                            {String(item.vendor || "?").charAt(0).toUpperCase()}
                          </span>
                          <span className="recent-vendor">{item.vendor || "Unnamed vendor"}</span>
                          <span className="date-cell">{item.date || "Date unavailable"}</span>
                          <strong>{money(Number(item.amount) || 0)}</strong>
                        </div>
                      ))}
                    {transactions.length === 0 && (
                      <p className="analytics-empty">No transactions saved yet.</p>
                    )}
                  </div>
                </div>
                <aside className="panel insight-summary">
                  <h2>Spending snapshot</h2>
                  <p>
                    {highestCategory?.amount > 0
                      ? `${highestCategory.name} is your highest-spending category at ${money(highestCategory.amount)}.`
                      : "Add transactions to see your top spending category."}
                  </p>
                  <p>
                    {monthlyAnalytics.change === null
                      ? "There is not enough previous-month data for a spending comparison."
                      : `Monthly spending is ${Math.abs(monthlyAnalytics.change).toFixed(1)}% ${
                          monthlyAnalytics.change > 0 ? "higher" : "lower"
                        } than last month.`}
                  </p>
                  <button className="text-button" onClick={() => setActivePage("Insights")}>
                    Explore insights <span>→</span>
                  </button>
                </aside>
              </section>
            </>
          ) : activePage === "Categories" ? (
            <section className="panel category-page">
              <div className="section-heading">
                <div>
                  <h2>Your categories</h2>
                  <p>{money(categoryTotal)} recorded across {categories.length} categories. Select a category to view its documents.</p>
                </div>
              </div>
              <div className="category-grid">
                {categoryTotals.map((item) => (
                  <button
                    key={item.name}
                    className="category-tile"
                    onClick={() => {
                      setCategory(item.name);
                      setActivePage("Documents");
                    }}
                  >
                    <span className="category-dot" style={{ background: item.color }} />
                    <strong>{item.name}</strong>
                    <span>{money(item.amount)}</span>
                  </button>
                ))}
              </div>
              <div className="category-total-breakdown">
                {categoryTotals.map((item) => (
                  <div className="category-breakdown-row" key={item.name}>
                    <span>{item.name}</span>
                    <div className="category-breakdown-track">
                      <span
                        style={{
                          width: `${categoryTotal ? item.amount / categoryTotal * 100 : 0}%`,
                          background: item.color,
                        }}
                      />
                    </div>
                    <strong>{money(item.amount)}</strong>
                  </div>
                ))}
                {categoryTotal === 0 && (
                  <p className="analytics-empty">No category spending to display yet.</p>
                )}
              </div>
            </section>
          ) : activePage === "Documents" ? (
            <>
              <section className="content-grid">
                <div className="panel transactions-panel">
                  <div className="section-heading">
                    <div>
                      <h2>All documents</h2>
                      <p>Review and organize your financial records.</p>
                    </div>
                    <button className="text-button" onClick={() => setActivePage("Documents")}>
                      View all <span>→</span>
                    </button>
                  </div>

                  <div className="table-tools">
                    <div className="table-tools-row">
                      <div className="search-box">
                        <span>⌕</span>
                        <input
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder="Search vendors or categories..."
                          aria-label="Search transactions"
                        />
                        {search && <button onClick={() => setSearch("")} aria-label="Clear search">×</button>}
                      </div>
                      <select
                        value={category}
                        onChange={(event) => setCategory(event.target.value)}
                        aria-label="Filter by category"
                      >
                        <option value="All">All categories</option>
                        {categories.map((item) => (
                          <option key={item.name} value={item.name}>{item.name}</option>
                        ))}
                      </select>
                      <select
                        value={documentType}
                        onChange={(event) => setDocumentType(event.target.value)}
                        aria-label="Filter by document type"
                      >
                        <option value="All">All types</option>
                        <option value="Receipt">Receipt</option>
                        <option value="Invoice">Invoice</option>
                      </select>
                      <select
                        value={sortOrder}
                        onChange={(event) => setSortOrder(event.target.value)}
                        aria-label="Sort transactions"
                      >
                        <option value="newest">Newest first</option>
                        <option value="oldest">Oldest first</option>
                        <option value="amount-ascending">Amount: Low to High</option>
                        <option value="amount-descending">Amount: High to Low</option>
                      </select>
                    </div>
                    <div className="table-tools-row table-filter-range">
                      <label className="filter-field">
                        <span>Start date</span>
                        <input
                          type="date"
                          value={startDate}
                          onChange={(event) => setStartDate(event.target.value)}
                          aria-label="Start date"
                        />
                      </label>
                      <label className="filter-field">
                        <span>End date</span>
                        <input
                          type="date"
                          value={endDate}
                          onChange={(event) => setEndDate(event.target.value)}
                          aria-label="End date"
                        />
                      </label>
                      <label className="filter-field">
                        <span>Minimum amount</span>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={minAmount}
                          onChange={(event) => setMinAmount(event.target.value)}
                          placeholder="No minimum"
                          aria-label="Minimum amount"
                        />
                      </label>
                      <label className="filter-field">
                        <span>Maximum amount</span>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={maxAmount}
                          onChange={(event) => setMaxAmount(event.target.value)}
                          placeholder="No maximum"
                          aria-label="Maximum amount"
                        />
                      </label>
                      <button className="secondary-button clear-filters" onClick={clearFilters}>
                        Clear filters
                      </button>
                    </div>
                    {dateRangeError && (
                      <p className="filter-error" role="alert">
                        Start date must be on or before end date.
                      </p>
                    )}
                  </div>

                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Vendor</th>
                          <th>Date</th>
                          <th>Amount</th>
                          <th>Category</th>
                          <th>Type</th>
                          <th><span className="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <div className="vendor-cell">
                                <div className="vendor-avatar">
                                  {String(item.vendor || "?").charAt(0).toUpperCase()}
                                </div>
                                <span className="vendor-name">{item.vendor || "Unnamed vendor"}</span>
                              </div>
                            </td>
                            <td className="date-cell">{item.date || "—"}</td>
                            <td className="amount-cell">{money(Number(item.amount) || 0)}</td>
                            <td><span className={`category-tag tag-${String(item.category || "").toLowerCase()}`}>{item.category || "Other"}</span></td>
                            <td><span className={`type-tag ${item.type === "Invoice" ? "invoice-tag" : "receipt-tag"}`}>{item.type}</span></td>
                            <td>
                              <div className="row-actions">
  <button
    className="edit-button"
    onClick={() => openEditForm(item)}
    title={`Edit ${item.vendor}`}
    aria-label={`Edit ${item.vendor}`}
  >
    Edit
  </button>

  <button
    className="delete-button"
    onClick={() => deleteTransaction(item.id)}
    title={`Remove ${item.vendor}`}
    aria-label={`Remove ${item.vendor}`}
  >
    ×
  </button>
</div>
                            </td>
                          </tr>
                        ))}
                        {filtered.length === 0 && (
                          <tr><td colSpan="6" className="empty-state">
                            {transactions.length === 0
                              ? "No transactions yet. Add a transaction or upload a receipt."
                              : "No matching documents found."}
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="table-footer">
                    Showing {filtered.length} of {transactions.length} documents
                  </div>
                </div>

                <div className="document-tools">
                  <section className="upload-card">
                    <div className="upload-heading">
                      <div>
                        <h2>Quick upload</h2>
                        <p>Bring your paperwork together.</p>
                      </div>
                      <span className="upload-heading-icon">↥</span>
                    </div>
                    <button className="drop-zone" onClick={() => setShowUpload(true)}>
                      <span className="cloud-icon">⇧</span>
                      <strong>Upload your documents</strong>
                      <span>PDF, JPG or PNG</span>
                      <span className="browse-text">Choose files <span>→</span></span>
                    </button>
                    <p className="upload-note">Uploaded records need your review. This demo doesn't extract document text yet.</p>
                  </section>
                </div>
              </section>
            </>
          ) : activePage === "Budgets" ? (
            <section className="budget-page">
              <div className="budget-page-heading">
                <div>
                  <h2>Monthly budgets</h2>
                  <p>Budgets are saved separately from your transaction records.</p>
                </div>
                <label className="budget-month">
                  <span>Budget month</span>
                  <input
                    type="month"
                    value={budgetMonth}
                    onChange={(event) => setBudgetMonth(event.target.value)}
                  />
                </label>
              </div>

              <section className="panel budget-card overall-budget">
                <div className="budget-card-heading">
                  <div>
                    <h3>Overall monthly budget</h3>
                    <p>Spending this month: {money(budgetTotalSpending)}</p>
                  </div>
                  <label className="budget-input">
                    <span>Monthly limit</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={budgetSettings.overall}
                      onChange={(event) =>
                        setBudgetSettings((previous) => ({
                          ...previous,
                          overall: event.target.value,
                        }))
                      }
                      placeholder="Set a limit"
                    />
                  </label>
                </div>
                {Number(budgetSettings.overall) > 0 && (
                  <>
                    <div className="budget-progress">
                      <span
                        className={budgetTotalSpending >= Number(budgetSettings.overall) ? "over-budget" : ""}
                        style={{
                          width: `${Math.min(100, budgetTotalSpending / Number(budgetSettings.overall) * 100)}%`,
                        }}
                      />
                    </div>
                    <div className="budget-stats">
                      <span>{Math.round(budgetTotalSpending / Number(budgetSettings.overall) * 100)}% used</span>
                      <strong>
                        {budgetTotalSpending > Number(budgetSettings.overall)
                          ? `Over by ${money(budgetTotalSpending - Number(budgetSettings.overall))}`
                          : `${money(Number(budgetSettings.overall) - budgetTotalSpending)} remaining`}
                      </strong>
                    </div>
                    {budgetTotalSpending / Number(budgetSettings.overall) >= 0.8 && (
                      <p className="budget-warning" role="status">
                        {budgetTotalSpending > Number(budgetSettings.overall)
                          ? "You are over your overall monthly budget."
                          : "You have used at least 80% of your overall monthly budget."}
                      </p>
                    )}
                  </>
                )}
              </section>

              <div className="budget-category-grid">
                {categories.map((item) => {
                  const limit = Number(budgetSettings.categories[item.name]) || 0;
                  const spending = budgetCategorySpending[item.name] || 0;
                  const percent = limit ? spending / limit * 100 : 0;
                  return (
                    <section className="panel budget-card" key={item.name}>
                      <div className="budget-card-heading">
                        <div className="budget-category-title">
                          <span className="category-dot" style={{ background: item.color }} />
                          <h3>{item.name}</h3>
                        </div>
                        <label className="budget-input">
                          <span>Monthly limit</span>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={budgetSettings.categories[item.name] ?? ""}
                            onChange={(event) =>
                              setBudgetSettings((previous) => ({
                                ...previous,
                                categories: {
                                  ...previous.categories,
                                  [item.name]: event.target.value,
                                },
                              }))
                            }
                            placeholder="Set a limit"
                          />
                        </label>
                      </div>
                      <p className="budget-spending">Spent {money(spending)}</p>
                      {limit > 0 && (
                        <>
                          <div className="budget-progress">
                            <span className={percent >= 100 ? "over-budget" : ""} style={{ width: `${Math.min(100, percent)}%` }} />
                          </div>
                          <div className="budget-stats">
                            <span>{Math.round(percent)}% used</span>
                            <strong>{spending > limit ? `Over by ${money(spending - limit)}` : `${money(limit - spending)} remaining`}</strong>
                          </div>
                          {percent >= 80 && (
                            <p className="budget-warning" role="status">
                              {percent >= 100 ? "This category is over budget." : "At least 80% of this category budget is used."}
                            </p>
                          )}
                        </>
                      )}
                    </section>
                  );
                })}
              </div>
              <div className="budget-save-row">
                <button className="primary-button" onClick={persistBudgetSettings}>
                  Save budget settings
                </button>
              </div>
            </section>
          ) : activePage === "Insights" ? (
            <section className="insights-page">
              <div className="stats-grid insight-stats">
                <article className="stat-card">
                  <div className="stat-top"><span>Spent this month</span><span className="stat-icon green">₹</span></div>
                  <h2>{money(insightsData.currentMonthExpenses)}</h2>
                  <p className="stat-foot muted-foot">Dated expenses through today</p>
                </article>
                <article className="stat-card">
                  <div className="stat-top"><span>Budget remaining</span><span className="stat-icon blue">↘</span></div>
                  <h2>{insightsData.remainingBudget === null ? "Not set" : money(insightsData.remainingBudget)}</h2>
                  <p className="stat-foot muted-foot">Against the overall monthly budget</p>
                </article>
                <article className="stat-card">
                  <div className="stat-top"><span>Month-end estimate</span><span className="stat-icon purple">↗</span></div>
                  <h2>{money(insightsData.projectedSpending)}</h2>
                  <p className="stat-foot muted-foot">Estimate based on {insightsData.elapsedDays} of {insightsData.daysInMonth} days</p>
                </article>
                <article className="stat-card">
                  <div className="stat-top"><span>Active alerts</span><span className="stat-icon amber">!</span></div>
                  <h2>{insightsData.budgetAlerts.length + insightsData.unusualExpenses.length}</h2>
                  <p className="stat-foot muted-foot">Budget thresholds and possible unusual expenses</p>
                </article>
              </div>

              {transactions.length === 0 && (
                <div className="insights-empty panel">
                  <h2>Your insights will appear here</h2>
                  <p>Add transactions to see spending patterns, budget alerts, and estimates based on your own records.</p>
                </div>
              )}

              <section className="panel smart-alerts-panel">
                <div className="section-heading">
                  <div><h2>Smart spending alerts</h2><p>Warnings appear at 80% of a positive monthly budget; critical alerts appear only after it is exceeded.</p></div>
                </div>
                {insightsData.budgetAlerts.length === 0 ? (
                  <p className="analytics-empty">No budget alerts right now. Set a positive budget to monitor your spending.</p>
                ) : (
                  <div className="smart-alert-list">
                    {insightsData.budgetAlerts.map((alert) => (
                      <article className={`smart-alert ${alert.severity}`} key={alert.key}>
                        <div className="smart-alert-heading">
                          <div>
                            <span className="alert-status">{alert.severity === "critical" ? "Critical: over budget" : "Warning: budget nearly reached"}</span>
                            <h3>{alert.name}</h3>
                          </div>
                          <strong>{alert.percent.toFixed(0)}% used</strong>
                        </div>
                        <div
                          className="budget-progress smart-alert-progress"
                          role="progressbar"
                          aria-label={`${alert.name} used`}
                          aria-valuemin="0"
                          aria-valuemax="100"
                          aria-valuenow={Math.min(100, Math.round(alert.percent))}
                        >
                          <span className={alert.severity === "critical" ? "over-budget" : ""} style={{ width: `${Math.min(100, alert.percent)}%` }} />
                        </div>
                        <div className="budget-stats">
                          <span>Spent {money(alert.spent)} of {money(alert.limit)}</span>
                          <strong>{alert.remaining >= 0 ? `${money(alert.remaining)} remaining` : `${money(Math.abs(alert.remaining))} over`}</strong>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="panel forecast-panel">
                <div className="analytics-heading">
                  <div><h2>Monthly spending forecast</h2><p>Estimate, not a guaranteed outcome. Future-dated transactions are excluded.</p></div>
                  {insightsData.remainingBudget !== null && <span className="analytics-period">Budget: {money(Number(budgetSettings.overall) || 0)}</span>}
                </div>
                <div className="monthly-summary">
                  <div><span>Actual spending so far</span><strong>{money(insightsData.currentMonthExpenses)}</strong></div>
                  <div><span>Projected month-end</span><strong>{money(insightsData.projectedSpending)}</strong></div>
                  <div><span>Days elapsed</span><strong>{insightsData.elapsedDays} / {insightsData.daysInMonth}</strong></div>
                </div>
                {insightsData.currentMonthExpenses === 0 && (
                  <p className="analytics-empty">No current-month expenses have been recorded through today, so the estimate is zero.</p>
                )}
              </section>

              <section className="panel monthly-comparison-panel">
                <div className="section-heading">
                  <div><h2>Month-over-month comparison</h2><p>Current-month expenses through today compared with the previous calendar month.</p></div>
                </div>
                <div className="comparison-values">
                  <div><span>This month</span><strong>{money(insightsData.currentMonthExpenses)}</strong></div>
                  <div><span>Previous month</span><strong>{money(monthlyAnalytics.previousMonth)}</strong></div>
                  {monthlyAnalytics.previousMonth > 0 ? (
                    <div>
                      <span>Change</span>
                      <strong className={insightsData.currentMonthExpenses > monthlyAnalytics.previousMonth ? "comparison-increase" : "comparison-decrease"}>
                        {insightsData.currentMonthExpenses > monthlyAnalytics.previousMonth ? "Increase" : insightsData.currentMonthExpenses < monthlyAnalytics.previousMonth ? "Decrease" : "No change"} of {money(Math.abs(insightsData.currentMonthExpenses - monthlyAnalytics.previousMonth))} ({(Math.abs(insightsData.currentMonthExpenses - monthlyAnalytics.previousMonth) / monthlyAnalytics.previousMonth * 100).toFixed(1)}%)
                      </strong>
                    </div>
                  ) : (
                    <div><span>Change</span><strong>{insightsData.currentMonthExpenses > 0 ? `Increase of ${money(insightsData.currentMonthExpenses)}; percentage change is unavailable because previous-month spending was zero.` : `No spending recorded in either month; difference is ${money(0)}.`}</strong></div>
                  )}
                </div>
              </section>

              <section className="panel recommendations-panel">
                <div className="section-heading recommendation-heading">
                  <div><h2>Saving recommendations</h2><p>Suggestions use recorded category spending. Savings are estimates, not guarantees.</p></div>
                  <label className="reduction-control">
                    <span>Estimated reduction</span>
                    <span className="reduction-input-wrap">
                      <input
                        aria-label="Estimated spending reduction percentage"
                        type="number"
                        min="1"
                        max="50"
                        step="1"
                        value={savingsReduction}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (Number.isFinite(value) && value >= 1 && value <= 50) setSavingsReduction(value);
                        }}
                      />
                      %
                    </span>
                  </label>
                </div>
                {insightsData.recommendations.length === 0 ? (
                  <p className="analytics-empty">Recommendations will appear when current-month spending, budget pressure, or a month-over-month category increase can be measured.</p>
                ) : (
                  <div className="recommendation-list">
                    {insightsData.recommendations.map((item) => (
                      <article className="recommendation-row" key={item.name}>
                        <div><h3>{item.name}</h3><ul>{item.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>
                        <p>Estimated savings at {savingsReduction}% reduction: <strong>{money(item.estimatedSavings)}</strong></p>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="panel unusual-expenses-panel">
                <div className="section-heading">
                  <div><h2>Possible unusual expenses</h2><p>Flagged only with at least five earlier dated expenses; each transaction is excluded from its own baseline.</p></div>
                </div>
                {insightsData.unusualExpenses.length === 0 ? (
                  <p className="analytics-empty">No possible unusual expenses identified from the available history. These alerts do not indicate confirmed fraud.</p>
                ) : (
                  <div className="unusual-expense-list">
                    {insightsData.unusualExpenses.slice(0, 5).map((item) => (
                      <article className="unusual-expense-row" key={item.key}>
                        <div><h3>{item.description}</h3><span>{item.date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span></div>
                        <div><strong>{money(item.amount)}</strong><p>Above the historical threshold of {money(item.threshold)} (mean {money(item.historicalMean)} across {item.historicalCount} earlier expenses).</p></div>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="analytics-panel">
                <div className="analytics-heading">
                  <div><h2>Monthly spending trends</h2><p>Recorded spending by transaction month</p></div>
                  <span className="analytics-period">
                    {monthlyAnalytics.change === null
                      ? "Comparison unavailable"
                      : `${Math.abs(monthlyAnalytics.change).toFixed(1)}% ${
                          monthlyAnalytics.change > 0 ? "higher" : "lower"
                        } vs last month`}
                  </span>
                </div>
                {monthlyAnalytics.months.some((month) => month.amount > 0) ? (
                  <MonthlyChart months={monthlyAnalytics.months} />
                ) : (
                  <p className="analytics-empty">No spending data is available for these months.</p>
                )}
                <div className="category-analytics">
                  <h3>Category-wise spending</h3>
                  {categoryBreakdown.length === 0 ? (
                    <p className="analytics-empty">No categorized spending to compare yet.</p>
                  ) : (
                    categoryBreakdown.map((item) => (
                      <div className="category-breakdown-row" key={item.name}>
                        <span>{item.name}</span>
                        <div className="category-breakdown-track">
                          <span style={{ width: `${categoryTotal ? item.amount / categoryTotal * 100 : 0}%`, background: item.color }} />
                        </div>
                        <strong>{money(item.amount)}</strong>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="panel largest-expense-panel">
                <div className="section-heading">
                  <div><h2>Largest recorded expense</h2><p>Based on the saved transaction history.</p></div>
                </div>
                {largestExpense && isExpenseTransaction(largestExpense) ? (
                  <div className="largest-expense-row">
                    <div><strong>{largestExpense.vendor || "Unnamed transaction"}</strong><span>{largestExpense.date || "Date unavailable"} · {largestExpense.category || "Uncategorized"}</span></div>
                    <strong>{money(Number(largestExpense.amount))}</strong>
                  </div>
                ) : <p className="analytics-empty">No expenses recorded yet.</p>}
              </section>

              <section className="panel recurring-panel">
                <div className="section-heading">
                  <div><h2>Possible recurring expenses</h2><p>Repeated vendors with at least three dated transactions and consistent intervals.</p></div>
                </div>
                {recurringExpenses.length === 0 ? (
                  <p className="analytics-empty">No possible recurring expenses identified from the available history.</p>
                ) : recurringExpenses.map((item) => (
                  <div className="recurring-row" key={item.vendor}>
                    <div><strong>{item.vendor}</strong><span>{item.frequency} · average {money(item.averageAmount)}</span></div>
                    <span>Next expected {item.nextDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                  </div>
                ))}
              </section>
            </section>
          ) : activePage === "Export" ? (
            <section className="panel export-page">
              <div className="section-heading">
                <div><h2>Export transactions</h2><p>Choose an optional date range. Leave both dates empty to export every transaction.</p></div>
              </div>
              <div className="export-controls">
                <label className="filter-field">
                  <span>Start date</span>
                  <input type="date" value={exportStartDate} onChange={(event) => { setExportStartDate(event.target.value); setExportError(""); }} />
                </label>
                <label className="filter-field">
                  <span>End date</span>
                  <input type="date" value={exportEndDate} onChange={(event) => { setExportEndDate(event.target.value); setExportError(""); }} />
                </label>
                <div className="export-match-count">Matching transactions: <strong>{budgetExportCount}</strong></div>
                <button className="primary-button" onClick={exportDateRange}>Export CSV</button>
              </div>
              {exportError && <p className="filter-error" role="alert">{exportError}</p>}
            </section>
          ) : null}

          <footer className="footer">
            <span>✳ BillBuddy</span>
            <span>Small steps toward more organized finances.</span>
          </footer>
        </div>
      </main>

      {showUpload && (
        <div className="modal-backdrop" onClick={() => setShowUpload(false)}>
          <section className="upload-modal" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowUpload(false)} aria-label="Close">×</button>
            <div className="modal-icon">↥</div>
            <h2>Upload documents</h2>
            <p>Choose invoices or receipts from your device.</p>
            <label className="modal-file-input">
              <span>Choose files</span>
             <input
  type="file"
  accept="image/png,image/jpeg"
  multiple={false}
  onChange={handleFiles}
/>
            </label>
            {isProcessingOCR && (
  <p className="loading-message">
    Reading your bill... {ocrProgress}%
  </p>
)}
            <small>PDF, JPG and PNG supported. Use sample files you are comfortable testing with.</small>
          </section>
        </div>
      )}
      
{showTransactionForm && (
  <div
    className="modal-backdrop"
    onClick={() => setShowTransactionForm(false)}
  >
    <section
      className="upload-modal transaction-modal"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        className="modal-close"
        onClick={() => setShowTransactionForm(false)}
        aria-label="Close"
      >
        ×
      </button>

      <div className="modal-icon">✎</div>

      <h2>{editingId !== null ? "Edit transaction" : "Add transaction"}</h2>
      <p>Enter the details from your receipt or invoice.</p>

      <form className="transaction-form" onSubmit={handleTransactionSubmit}>
        <label>
          Vendor name
          <input
            required
            maxLength={100}
            value={formData.vendor}
            onChange={(event) =>
              setFormData({ ...formData, vendor: event.target.value })
            }
            placeholder="e.g. Amazon India"
          />
        </label>

        <label>
          Date
          <input
            required
            type="date"
            value={formData.date}
            onChange={(event) =>
              setFormData({ ...formData, date: event.target.value })
            }
          />
        </label>

        <label>
          Amount (₹)
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={formData.amount}
            onChange={(event) =>
              setFormData({ ...formData, amount: event.target.value })
            }
            placeholder="e.g. 1299"
          />
        </label>

        <label>
          Category
          <select
            value={formData.category}
            onChange={(event) =>
              setFormData({ ...formData, category: event.target.value })
            }
          >
            <option value="Food">Food</option>
            <option value="Travel">Travel</option>
            <option value="Software">Software</option>
            <option value="Shopping">Shopping</option>
          </select>
        </label>

        <label>
          Document type
          <select
            value={formData.type}
            onChange={(event) =>
              setFormData({ ...formData, type: event.target.value })
            }
          >
            <option value="Receipt">Receipt</option>
            <option value="Invoice">Invoice</option>
          </select>
        </label>

        <div className="form-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => setShowTransactionForm(false)}
          >
            Cancel
          </button>

          <button type="submit" className="primary-button">
            {editingId !== null ? "Save changes" : "Add transaction"}
          </button>
        </div>
      </form>
    </section>
  </div>
)}

    </div>
  );
}

export default App;
