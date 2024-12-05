import React, { useState, useEffect } from 'react';
import { Search, Download } from 'lucide-react';
import Papa from 'papaparse';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import PortfolioManager from './PortfolioManager';
import SecurityChart from './SecurityChart';


function MarketDashboard() {
  const [activeTab, setActiveTab] = useState('stocks');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSector, setSelectedSector] = useState('all');
  const [stocksData, setStocksData] = useState([]);
  const [etfsData, setEtfsData] = useState([]);
  const [securitiesData, setSecuritiesData] = useState([]); // Keep this for backward compatibility
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const formatCVI = (value) => {
    if (typeof value === 'string') {
      value = parseFloat(value);
    }
    return value.toFixed(0);
  };

  const getThermoBox = (thermo) => {
    const baseStyle = "w-6 h-6 border-2 border-black rounded";
    switch (Number(thermo)) {
      case 1:
        return <div className={`${baseStyle} bg-green-500`} />;
      case 2:
        return <div className={`${baseStyle} bg-white`} />;
      case 4:
        return <div className={`${baseStyle} bg-red-500`} />;
      default:
        return <div className={`${baseStyle} bg-gray-300`} />;
    }
  };

  // Format rank change with color and sign
  const formatRankChange = (change) => {
    if (change === 0) {
      return <span className="text-gray-500">0</span>;
    }
    if (change > 0) {
      return <span className="text-green-500">+{change}</span>;
    }
    return <span className="text-red-500">{change}</span>;
  };

  //Download
  const handleDownloadPDF = () => {
    const doc = new jsPDF('l', 'pt'); // landscape orientation
    const pageHeight = doc.internal.pageSize.height;
    
    // Set title
    const title = `${activeTab.toUpperCase()} Market Report - ${new Date().toLocaleDateString()}`;
    doc.setFontSize(16);
    doc.text(title, 40, 40);
  
    // Define columns for the PDF (removed Volume, added Thermo)
    const columns = [
      { header: 'Rank', dataKey: 'rank' },
      { header: 'Change', dataKey: 'rankChange' },
      { header: 'Symbol', dataKey: 'Symbol' },
      { header: 'Name', dataKey: 'Name' },
      { header: activeTab === 'stocks' ? 'Sector' : 'Category', 
        dataKey: activeTab === 'stocks' ? 'Sector' : 'Category' },
      { header: 'Close', dataKey: 'Close' },
      { header: 'CVI', dataKey: 'CVI' },
      { header: 'SecState', dataKey: 'SecState' },
      { header: 'Thermo', dataKey: 'Thermostat' },
      { header: 'Days', dataKey: 'Days' }
    ];
  
    // Format data for PDF
    const tableData = filteredData.map(row => ({
      ...row,
      Close: `$${row.Close?.toFixed(2)}`,
      CVI: formatCVI(row.CVI),
      rankChange: row.rankChange > 0 ? `+${row.rankChange}` : row.rankChange,
      // Convert Thermostat number to colored cell
      Thermostat: row.Thermostat // We'll handle the coloring in willDrawCell
    }));
  
    // Generate table with autoTable
    doc.autoTable({
      columns,
      body: tableData,
      startY: 60,
      headStyles: { fillColor: [66, 139, 202], textColor: 255 },
      didDrawPage: (data) => {
        // Add header to each page
        doc.setFontSize(10);
        doc.text(title, 40, 20);
      },
      willDrawCell: (data) => {
        // Color the Thermostat cells based on value
        if (data.column.dataKey === 'Thermostat') {
          const value = data.cell.raw;
          if (value === 1) {
            data.cell.styles.fillColor = [34, 197, 94]; // green-500
          } else if (value === 2) {
            data.cell.styles.fillColor = [255, 255, 255]; // white
          } else if (value === 4) {
            data.cell.styles.fillColor = [239, 68, 68]; // red-500
          } else {
            data.cell.styles.fillColor = [209, 213, 219]; // gray-300
          }
        }
      },
      margin: { top: 40 },
      styles: { overflow: 'linebreak', cellWidth: 'wrap' },
      columnStyles: {
        Name: { cellWidth: 150 },
        Symbol: { cellWidth: 60 },
        rankChange: { halign: 'center' },
        Thermostat: { halign: 'center' },
        SecState: { halign: 'center' }
      }
    });
  
    // Save the PDF
    doc.save(`${activeTab}_report_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const S3_BASE_URL = 'https://corsproxy.io/?' + encodeURIComponent('https://cimseclist2075.s3.us-east-2.amazonaws.com/output/');

  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const fileName = activeTab === 'stocks' ? 'stock_summary.csv' : 'etf_summary.csv';
        const fileUrl = `${S3_BASE_URL}${fileName}`;

        console.log('Fetching from:', fileUrl);

        const response = await fetch(fileUrl);
        
        if (!response.ok) {
          throw new Error(`Failed to load ${fileName} (Status: ${response.status})`);
        }

        const csvText = await response.text();
        
        if (!csvText || csvText.trim().length === 0) {
          throw new Error('Received empty CSV data');
        }

        const results = Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: true,
          transformHeader: header => header.trim(),
          transform: value => typeof value === 'string' ? value.trim() : value
        });

        // Process data as before...
        const weekRankedData = [...results.data]
          .map(row => ({
            ...row,
            Close: parseFloat(row.Close) || 0,
            Volume: parseInt(row.Volume) || 0,
            CVI: parseFloat(row.CVI) || 0,
            SecState: parseInt(row.SecState) || 0,
            Thermostat: parseInt(row.Thermostat) || 0,
            VWRS: parseFloat(row.VWRS) || 0,
            VWRS_1wk: parseFloat(row.VWRS_1wk) || 0,
            Days: parseInt(row.Days) || 0
          }))
          .filter(row => !isNaN(row.VWRS) && !isNaN(row.VWRS_1wk)) 
          .sort((a, b) => b.VWRS_1wk - a.VWRS_1wk)
          .map((item, index) => ({
            ...item,
            weekRank: index + 1
          }));

        const sortedData = weekRankedData
          .sort((a, b) => b.VWRS - a.VWRS)
          .map((item, index) => ({
            ...item,
            rank: index + 1,
            rankChange: item.weekRank - (index + 1)
          }));

        if (activeTab === 'stocks') {
          setStocksData(sortedData);
        } else {
          setEtfsData(sortedData);
        }
        setSecuritiesData(sortedData);

      } catch (error) {
        console.error('Error loading data:', error);
        setError(`Failed to load data: ${error.message}`);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [activeTab]);


  // Get unique sectors/categories
  const getUniqueCategories = () => {
    const field = activeTab === 'stocks' ? 'Sector' : 'Category';
    const categories = [...new Set(securitiesData.map(item => item[field]))].filter(Boolean);
    return ['all', ...categories.sort()];
  };

  // Filter data
  const filteredData = securitiesData.filter(security => {
    const matchesSearch = 
      security.Symbol?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      security.Name?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const categoryField = activeTab === 'stocks' ? 'Sector' : 'Category';
    const matchesCategory = 
      selectedSector === 'all' || 
      security[categoryField]?.toString().toLowerCase() === selectedSector.toLowerCase();
    
    return matchesSearch && matchesCategory;
  });

    return (
      <div className="min-h-screen bg-gray-50 p-6">
        {/* Tab Navigation */}
        <div className="mb-6 bg-white rounded-lg shadow">
          <div className="flex border-b">
            {['stocks', 'etfs', 'portfolio', 'chart'].map((tab) => (
              <button
                key={tab}
                className={`px-6 py-4 text-sm font-medium ${
                  activeTab === tab 
                    ? 'border-b-2 border-blue-500 text-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                onClick={() => setActiveTab(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>

      {(activeTab === 'stocks' || activeTab === 'etfs') && (
        <>
          {/* Search and Filter Bar */}
          <div className="flex flex-col md:flex-row gap-4 bg-white p-4 rounded-lg shadow mb-6">
            <div className="flex-1 flex items-center bg-gray-100 rounded-md px-3">
              <Search className="w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder={`Search ${activeTab}...`}
                className="flex-1 bg-transparent border-none focus:outline-none px-3 py-2"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="flex-none">
              <select
                className="w-full md:w-48 p-2 border rounded-md bg-white"
                value={selectedSector}
                onChange={(e) => setSelectedSector(e.target.value)}
              >
                {getUniqueCategories().map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
            {/* Add this new button */}
            <button
              onClick={handleDownloadPDF}
              className="flex items-center justify-center px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
            >
              <Download className="w-4 h-4 mr-2" />
              Download PDF
            </button>
          </div>
    

          {/* Data Table */}
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            {isLoading ? (
              <div className="p-4 text-center">Loading...</div>
            ) : error ? (
              <div className="p-4 text-center text-red-500">{error}</div>
            ) : (
              <table className="w-full min-w-max">
                <thead>
                  <tr className="text-center border-b">
                    <th className="p-4">Rank</th>
                    <th className="p-4">Change</th>
                    <th className="p-4">Symbol</th>
                    <th className="p-4">Name</th>
                    <th className="p-4">{activeTab === 'stocks' ? 'Sector' : 'Category'}</th>
                    <th className="p-4">Close</th>
                    <th className="p-4">Volume</th>
                    <th className="p-4">CVI</th>
                    <th className="p-4">SecState</th>
                    <th className="p-4 text-center">Thermo</th>
                    <th className="p-4">Days</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.map((security) => (
                    <tr key={security.rank} className="border-b hover:bg-gray-50">
                      <td className="p-4 font-medium">{security.rank}</td>
                      <td className="p-4 font-medium">{formatRankChange(security.rankChange)}</td>
                      <td className="p-4 font-medium">{security.Symbol}</td>
                      <td className="p-4">{security.Name}</td>
                      <td className="p-4">{activeTab === 'stocks' ? security.Sector : security.Category}</td>
                      <td className="p-4">${security.Close?.toFixed(2)}</td>
                      <td className="p-4">{security.Volume?.toLocaleString()}</td>
                      <td className="p-4">{formatCVI(security.CVI)}</td>
                      <td className="p-4">{security.SecState}</td>
                      <td className="p-4 flex justify-center">
                        {getThermoBox(security.Thermostat)}
                      </td>
                      <td className="p-4">{security.Days}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {activeTab === 'portfolio' && (
        <PortfolioManager securitiesData={[...stocksData, ...etfsData]} />
      )}

      {activeTab === 'chart' && <SecurityChart />}
    </div>
  );
}

export default MarketDashboard;