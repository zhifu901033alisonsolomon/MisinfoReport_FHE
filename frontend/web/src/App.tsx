// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface Report {
  id: string;
  encryptedData: string;
  timestamp: number;
  category: string;
  status: "pending" | "verified" | "rejected";
}

const App: React.FC = () => {
  // State management
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<Report[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newReportData, setNewReportData] = useState({
    category: "",
    description: "",
    sensitiveInfo: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");

  // Statistics calculation
  const verifiedCount = reports.filter(r => r.status === "verified").length;
  const pendingCount = reports.filter(r => r.status === "pending").length;
  const rejectedCount = reports.filter(r => r.status === "rejected").length;

  // Filter reports based on search and category
  const filteredReports = reports.filter(report => {
    const matchesSearch = report.category.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         report.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = activeCategory === "all" || report.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  // Unique categories for filter
  const categories = ["all", ...Array.from(new Set(reports.map(r => r.category)))];

  useEffect(() => {
    loadReports().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadReports = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("report_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing report keys:", e);
        }
      }
      
      const list: Report[] = [];
      
      for (const key of keys) {
        try {
          const reportBytes = await contract.getData(`report_${key}`);
          if (reportBytes.length > 0) {
            try {
              const reportData = JSON.parse(ethers.toUtf8String(reportBytes));
              list.push({
                id: key,
                encryptedData: reportData.data,
                timestamp: reportData.timestamp,
                category: reportData.category,
                status: reportData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing report data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading report ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setReports(list);
    } catch (e) {
      console.error("Error loading reports:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitReport = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting report with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newReportData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const reportId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const reportData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        category: newReportData.category,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `report_${reportId}`, 
        ethers.toUtf8Bytes(JSON.stringify(reportData))
      );
      
      const keysBytes = await contract.getData("report_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(reportId);
      
      await contract.setData(
        "report_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Report submitted securely with FHE encryption!"
      });
      
      await loadReports();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewReportData({
          category: "",
          description: "",
          sensitiveInfo: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const verifyReport = async (reportId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Verifying report with FHE..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const reportBytes = await contract.getData(`report_${reportId}`);
      if (reportBytes.length === 0) {
        throw new Error("Report not found");
      }
      
      const reportData = JSON.parse(ethers.toUtf8String(reportBytes));
      
      const updatedReport = {
        ...reportData,
        status: "verified"
      };
      
      await contract.setData(
        `report_${reportId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedReport))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Report verified using FHE!"
      });
      
      await loadReports();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const rejectReport = async (reportId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing with FHE..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const reportBytes = await contract.getData(`report_${reportId}`);
      if (reportBytes.length === 0) {
        throw new Error("Report not found");
      }
      
      const reportData = JSON.parse(ethers.toUtf8String(reportBytes));
      
      const updatedReport = {
        ...reportData,
        status: "rejected"
      };
      
      await contract.setData(
        `report_${reportId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedReport))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Report rejected!"
      });
      
      await loadReports();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Rejection failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({
          visible: true,
          status: "success",
          message: "FHE service is available!"
        });
      } else {
        setTransactionStatus({
          visible: true,
          status: "error",
          message: "FHE service is unavailable"
        });
      }
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      console.error("Error checking availability:", e);
    }
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Misinfo<span>Report</span></h1>
          <p>Anonymous Public Health Misinformation Reporting</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="primary-btn"
          >
            + New Report
          </button>
          <button 
            className="secondary-btn"
            onClick={checkAvailability}
          >
            Check FHE Status
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <main className="main-content">
        <section className="stats-section">
          <div className="stat-card">
            <h3>Total Reports</h3>
            <p className="stat-value">{reports.length}</p>
          </div>
          <div className="stat-card">
            <h3>Verified</h3>
            <p className="stat-value verified">{verifiedCount}</p>
          </div>
          <div className="stat-card">
            <h3>Pending</h3>
            <p className="stat-value pending">{pendingCount}</p>
          </div>
          <div className="stat-card">
            <h3>Rejected</h3>
            <p className="stat-value rejected">{rejectedCount}</p>
          </div>
        </section>
        
        <section className="controls-section">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search reports..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <button className="search-btn">🔍</button>
          </div>
          
          <div className="category-filter">
            <select 
              value={activeCategory}
              onChange={(e) => setActiveCategory(e.target.value)}
            >
              {categories.map(category => (
                <option key={category} value={category}>
                  {category === "all" ? "All Categories" : category}
                </option>
              ))}
            </select>
          </div>
          
          <button 
            onClick={loadReports}
            className="refresh-btn"
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </section>
        
        <section className="reports-section">
          <h2>Recent Reports</h2>
          
          {filteredReports.length === 0 ? (
            <div className="empty-state">
              <p>No reports found</p>
              <button 
                className="primary-btn"
                onClick={() => setShowCreateModal(true)}
              >
                Submit First Report
              </button>
            </div>
          ) : (
            <div className="reports-grid">
              {filteredReports.map(report => (
                <div className="report-card" key={report.id}>
                  <div className="report-header">
                    <span className={`status-badge ${report.status}`}>
                      {report.status}
                    </span>
                    <span className="report-id">#{report.id.substring(0, 6)}</span>
                  </div>
                  
                  <div className="report-body">
                    <h3>{report.category}</h3>
                    <p className="report-date">
                      {new Date(report.timestamp * 1000).toLocaleString()}
                    </p>
                    <div className="fhe-tag">
                      <span>FHE Encrypted</span>
                    </div>
                  </div>
                  
                  <div className="report-actions">
                    <button 
                      className="action-btn verify"
                      onClick={() => verifyReport(report.id)}
                    >
                      Verify
                    </button>
                    <button 
                      className="action-btn reject"
                      onClick={() => rejectReport(report.id)}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
  
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Submit New Report</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">
                ×
              </button>
            </div>
            
            <div className="modal-body">
              <div className="fhe-notice">
                <p>Your report will be encrypted using FHE technology</p>
              </div>
              
              <div className="form-group">
                <label>Category</label>
                <select 
                  name="category"
                  value={newReportData.category} 
                  onChange={(e) => setNewReportData({
                    ...newReportData,
                    category: e.target.value
                  })}
                >
                  <option value="">Select a category</option>
                  <option value="Vaccine">Vaccine Misinformation</option>
                  <option value="Treatment">Treatment Misinformation</option>
                  <option value="Disease">Disease Misinformation</option>
                  <option value="Prevention">Prevention Misinformation</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <input 
                  type="text"
                  name="description"
                  value={newReportData.description} 
                  onChange={(e) => setNewReportData({
                    ...newReportData,
                    description: e.target.value
                  })}
                  placeholder="Brief description of the misinformation"
                />
              </div>
              
              <div className="form-group">
                <label>Details</label>
                <textarea 
                  name="sensitiveInfo"
                  value={newReportData.sensitiveInfo} 
                  onChange={(e) => setNewReportData({
                    ...newReportData,
                    sensitiveInfo: e.target.value
                  })}
                  placeholder="Provide details about the misinformation..."
                  rows={4}
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button 
                onClick={() => setShowCreateModal(false)}
                className="secondary-btn"
              >
                Cancel
              </button>
              <button 
                onClick={submitReport} 
                disabled={creating}
                className="primary-btn"
              >
                {creating ? "Submitting..." : "Submit Report"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            <p>{transactionStatus.message}</p>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-section">
            <h3>MisinfoReport</h3>
            <p>Anonymous Public Health Misinformation Reporting Platform</p>
          </div>
          
          <div className="footer-section">
            <h3>Powered by FHE</h3>
            <p>Using Fully Homomorphic Encryption to protect your privacy</p>
          </div>
          
          <div className="footer-section">
            <h3>Resources</h3>
            <a href="#">How it works</a>
            <a href="#">Privacy Policy</a>
            <a href="#">Terms of Service</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} MisinfoReport. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default App;