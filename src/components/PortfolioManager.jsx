import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Download } from 'lucide-react';
import Papa from 'papaparse';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

const S3_BASE_URL = 'https://corsproxy.io/?' + encodeURIComponent('https://cimseclist2075.s3.us-east-2.amazonaws.com/output/');

const PortfolioManager = ({ securitiesData }) => {
  const [portfolio, setPortfolio] = useState(() => {
    const saved = localStorage.getItem('portfolio');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [searchTerm, setSearchTerm] = useState('');
  const [portfolioCVI, setPortfolioCVI] = useState(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [activeChart, setActiveChart] = useState('allocation');
  const [portfolioPrices, setPortfolioPrices] = useState(null);
  const [rollingCVIs, setRollingCVIs] = useState(null);
  const [weightedCVIs, setWeightedCVIs] = useState(null);

  useEffect(() => {
    localStorage.setItem('portfolio', JSON.stringify(portfolio));
  }, [portfolio]);

  const totalAllocation = portfolio.reduce((sum, holding) => sum + (holding.allocation || 0), 0);

  useEffect(() => {
    const isValid = Math.abs(totalAllocation - 100) < 0.01;
    
    if (isValid && !isCalculating) {
      calculatePortfolioCVI();
    }
  }, [totalAllocation, portfolio]);

  const addToPortfolio = (security) => {
    if (!portfolio.some(h => h.Symbol === security.Symbol)) {
      setPortfolio([...portfolio, {
        ...security,
        allocation: 0
      }]);
      setSearchTerm('');
    }
  };

  const removeFromPortfolio = (symbol) => {
    setPortfolio(portfolio.filter(holding => holding.Symbol !== symbol));
  };

  const updateAllocation = (symbol, newAllocation) => {
    const numericAllocation = parseFloat(newAllocation) || 0;
    setPortfolio(portfolio.map(holding => 
      holding.Symbol === symbol 
        ? { ...holding, allocation: numericAllocation }
        : holding
    ));
  };

  const cycleChart = (direction) => {
    const charts = ['allocation', 'performance', 'volatility', 'diversification'];
    const currentIndex = charts.indexOf(activeChart);
    if (direction === 'next') {
      setActiveChart(charts[(currentIndex + 1) % charts.length]);
    } else {
      setActiveChart(charts[(currentIndex - 1 + charts.length) % charts.length]);
    }
  };

  const calculateWeightedCVI = () => {
    if (portfolio.length === 0) return 0;
    
    const weightedSum = portfolio.reduce((sum, holding) => {
      const weight = holding.allocation / 100;
      const cvi = parseFloat(holding.CVI) || 0;
      return sum + (weight * cvi);
    }, 0);
    
    return weightedSum;
  };

  const calculateContinuousCVI = (prices) => {
    if (prices.length < 68) return Array(prices.length).fill(0);
  
    // Calculate all log returns first
    const returns = prices.map((price, i) => 
      i === 0 ? 0 : Math.log(prices[i] / prices[i-1]) ** 2
    );
  
    // Initialize first 67 days with 0
    const cviValues = Array(67).fill(0);
    
    // EMA calculation starting from day 68
    const period = 67;
    const alpha = 2 / (period + 1);
    let ema = returns.slice(1, 68).reduce((sum, val) => sum + val) / period;
    
    // Calculate and store CVI values starting from day 68
    const cviScale = Math.sqrt(252) * 500;
    for (let i = 67; i < returns.length; i++) {
      ema = ema + (returns[i] - ema) * alpha;
      cviValues.push(Math.round(Math.sqrt(ema) * cviScale));
    }
  
    return cviValues;
  };

  const calculatePortfolioCVI = async () => {
    if (portfolio.length === 0) return;
  
    setIsCalculating(true);
    try {
      const securitiesHistory = await Promise.all(
        portfolio.map(async (holding) => {
          if (holding.allocation === 0) return null;
          
          // Update the fetch URL to use S3
          const response = await fetch(`${S3_BASE_URL}${holding.Symbol}_data.csv`);
          if (!response.ok) {
            console.error(`Failed to fetch data for ${holding.Symbol}:`, response.status);
            throw new Error(`Failed to fetch data for ${holding.Symbol}`);
          }
          
          const csvText = await response.text();
          if (!csvText || csvText.trim().length === 0) {
            throw new Error(`Empty data received for ${holding.Symbol}`);
          }
  
          console.log(`Data received for ${holding.Symbol}, first 100 chars:`, csvText.substring(0, 100));
  
          const { data } = Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true
          });
  
          if (!data || data.length === 0) {
            throw new Error(`Invalid data format for ${holding.Symbol}`);
          }
  
          return {
            symbol: holding.Symbol,
            allocation: holding.allocation,
            closePrices: data.map(row => row.Close),
            cviValues: data.map(row => row.CVI)
          };
        })
      );
  
      const validHistories = securitiesHistory.filter(item => item !== null);
      if (validHistories.length === 0) {
        throw new Error('No valid security data available');
      }
  
      // Rest of your existing code remains the same...
      const historyLength = Math.min(...validHistories.map(item => item.closePrices.length));
      const startIndex = Math.max(0, historyLength - 250);
  
      const portfolioPrices = [];
      const tempWeightedCVIs = [];
      
      for (let i = startIndex; i < historyLength; i++) {
        const dayPrice = validHistories.reduce((sum, security) => {
          const weight = security.allocation / 100;
          return sum + (security.closePrices[i] * weight);
        }, 0);
        portfolioPrices.push(dayPrice);
  
        const dayWeightedCVI = validHistories.reduce((sum, security) => {
          const weight = security.allocation / 100;
          return sum + (security.cviValues[i] * weight);
        }, 0);
        tempWeightedCVIs.push(dayWeightedCVI);
      }
  
      const initialPrice = portfolioPrices[0];
      const normalizedPrices = portfolioPrices.map(price => (price / initialPrice) * 100);
      setPortfolioPrices(normalizedPrices);
  
      const cviValues = calculateContinuousCVI(normalizedPrices);
      setPortfolioCVI(cviValues[cviValues.length - 1]);
      setRollingCVIs(cviValues);
      setWeightedCVIs(tempWeightedCVIs);
  
    } catch (error) {
      console.error('Error calculating portfolio CVI:', error);
      setPortfolioCVI(null);
      setWeightedCVIs(null);
    } finally {
      setIsCalculating(false);
    }
  };

  const exportPortfolioData = () => {
    if (!portfolioPrices || !rollingCVIs || !weightedCVIs) return;

    const csvData = [
      ['Day', 'Portfolio Value', 'Portfolio CVI', 'Weighted Average CVI', 'Benefit of Diversification']
    ];
  
    for (let i = 0; i < portfolioPrices.length; i++) {
      const cvi = rollingCVIs[i] || 0;
      const weightedCvi = weightedCVIs[i] || 0;
      const diversificationBenefit = cvi && weightedCvi ? 
        ((1 - (cvi / weightedCvi)) * 100) : 0;
  
      csvData.push([
        i + 1,
        portfolioPrices[i].toFixed(2),
        cvi.toFixed(1),
        weightedCvi.toFixed(1),
        diversificationBenefit.toFixed(1)
      ]);
    }
  
    const csvString = csvData.map(row => row.join(',')).join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', 'portfolio_data.csv');
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };
  

  // Update the performance chart render function:
  const renderPerformanceChart = () => {
    if (!portfolioPrices) return null;
    
    const performanceData = portfolioPrices.map((price, index) => ({
      day: index,
      price: price.toFixed(2)
    }));
  
    // Calculate min and max for Y axis with a small buffer
    const minPrice = Math.floor(Math.min(...portfolioPrices));
    const maxPrice = Math.ceil(Math.max(...portfolioPrices));
    const buffer = (maxPrice - minPrice) * 0.05; // 5% buffer
  
    return (
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={performanceData} margin={{ top: 5, right: 20, bottom: 25, left: 40 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis 
            dataKey="day" 
            label={{ value: 'Days', position: 'bottom' }}
            ticks={[0, 50, 100, 150, 200, 250]}
          />
          <YAxis 
            label={{ value: 'Portfolio Value ($)', angle: -90, position: 'insideLeft', offset: 10 }}
            domain={[minPrice - buffer, maxPrice + buffer]} // Set dynamic domain with buffer
          />
          <Tooltip 
            formatter={(value) => [`$${value}`, 'Portfolio Value']}
            labelFormatter={(label) => `Day ${label}`}
          />
          <Line 
            type="monotone" 
            dataKey="price" 
            stroke="#2563eb" 
            strokeWidth={2} 
            dot={false} 
          />
        </LineChart>
      </ResponsiveContainer>
    );
  };
  
  // Update the volatility chart render function:
  const renderVolatilityChart = () => {
    if (!rollingCVIs) return null;
  
    const volatilityData = rollingCVIs.map((cvi, index) => ({
      day: index, 
      cvi: cvi
    }));
  
    return (
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={volatilityData} margin={{ top: 5, right: 20, bottom: 25, left: 40 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis 
            dataKey="day" 
            label={{ value: 'Days', position: 'bottom' }}
            ticks={[0, 50, 100, 150, 200, 250]}
          />
          <YAxis 
            label={{ value: 'CVI', angle: -90, position: 'insideLeft', offset: 10 }} 
          />
          <Tooltip 
            formatter={(value) => [`CVI: ${value.toFixed(1)}`, 'Volatility']}
            labelFormatter={(label) => `Day ${label}`}
          />
          <Line 
            type="monotone" 
            dataKey="cvi" 
            stroke="#8884d8" 
            strokeWidth={2} 
            dot={false} 
          />
        </LineChart>
      </ResponsiveContainer>
    );
  };

  //Diversification Chart
  const renderDiversificationChart = () => {
    if (!rollingCVIs || !weightedCVIs) return null;
  
    const diversificationData = rollingCVIs.map((cvi, index) => ({
      day: index,
      benefit: cvi && weightedCVIs[index] ? 
        ((1 - (cvi / weightedCVIs[index])) * 100) : 0
    }));
  
    return (
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={diversificationData} margin={{ top: 5, right: 20, bottom: 25, left: 40 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis 
            dataKey="day" 
            label={{ value: 'Days', position: 'bottom' }}
            ticks={[0, 50, 100, 150, 200, 250]}
          />
          <YAxis 
            label={{ value: 'Benefit (%)', angle: -90, position: 'insideLeft', offset: 10 }}
            domain={[0, 100]}
          />
          <Tooltip 
            formatter={(value) => [`${value.toFixed(1)}%`, 'Diversification Benefit']}
            labelFormatter={(label) => `Day ${label}`}
          />
          <Line 
            type="monotone" 
            dataKey="benefit"
            stroke="#00C49F" 
            strokeWidth={2} 
            dot={false} 
          />
        </LineChart>
      </ResponsiveContainer>
    );
  };

 // Update Asset Allocation Chart 
  const renderAllocationChart = () => (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={portfolio.filter(h => h.allocation > 0)}
          dataKey="allocation"
          nameKey="Symbol"
          cx="50%"
          cy="50%"
          outerRadius={100}
          fill="#8884d8"
          label={({ Symbol, allocation }) => `${Symbol} (${allocation}%)`}
        >
          {portfolio.map((_, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );

  const getThermoBox = (thermo) => {
    const baseStyle = "w-6 h-6 border-2 border-black rounded";
    switch (Number(thermo)) {
      case 1:
        return <div className={`${baseStyle} bg-green-500`} title="Bullish" />;
      case 2:
        return <div className={`${baseStyle} bg-white`} title="Neutral" />;
      case 4:
        return <div className={`${baseStyle} bg-red-500`} title="Bearish" />;
      default:
        return <div className={`${baseStyle} bg-gray-300`} title="Unknown" />;
    }
  };

  const formatCVI = (value) => {
    if (typeof value === 'string') {
      value = parseFloat(value);
    }
    return value.toFixed(0);
  };

  const filteredSecurities = searchTerm.length >= 1
    ? securitiesData.filter(security =>
        security.Symbol?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        security.Name?.toLowerCase().includes(searchTerm.toLowerCase())
      ).slice(0, 10)
    : [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Portfolio Holdings */}
      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-xl font-bold mb-4">Portfolio Holdings</h2>
        <div className="mb-4">
          <div className="text-sm font-medium text-gray-500 mb-2">
            Total Allocation: {totalAllocation.toFixed(2)}%
            {totalAllocation !== 100 && (
              <span className="text-red-500 ml-2">
                (Should equal 100%)
              </span>
            )}
          </div>
        </div>
        <div className="space-y-4">
          {portfolio.map((holding) => (
            <div key={holding.Symbol} className="p-3 bg-gray-50 rounded">
              <div className="flex items-center gap-4 mb-2">
                <div className="flex-1">
                  <div className="font-medium">{holding.Symbol}</div>
                  <div className="text-sm text-gray-500">{holding.Name}</div>
                </div>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={holding.allocation || ''}
                  onChange={(e) => updateAllocation(holding.Symbol, e.target.value)}
                  className="w-20 px-2 py-1 border rounded"
                  placeholder="0%"
                />
                <button
                  onClick={() => removeFromPortfolio(holding.Symbol)}
                  className="p-1 text-red-500 hover:text-red-700"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-4 mt-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">SecState:</span>
                  <span className="font-medium">{holding.SecState}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">Thermo:</span>
                  {getThermoBox(holding.Thermostat)}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">CVI:</span>
                  <span className="font-medium">{formatCVI(holding.CVI)}</span>
                </div>
              </div>
            </div>
          ))}
          {portfolio.length === 0 && (
            <div className="text-center text-gray-500 py-4">
              No securities added to portfolio
            </div>
          )}
        </div>
      </div>

      {/* Portfolio Visualization */}
      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-xl font-bold mb-4">Portfolio Analysis</h2>
        {portfolio.length > 0 ? (
          <>
            <div className="mb-6 relative">
              <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 flex justify-between px-4 z-10">
                <button
                  onClick={() => cycleChart('prev')}
                  className="z-10 p-2 bg-white rounded-full shadow hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <button
                  onClick={() => cycleChart('next')}
                  className="z-10 p-2 bg-white rounded-full shadow hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>
              </div>
              
              <div className="transition-opacity duration-300">
                {activeChart === 'allocation' && renderAllocationChart()}
                {activeChart === 'performance' && renderPerformanceChart()}
                {activeChart === 'volatility' && renderVolatilityChart()}
                {activeChart === 'diversification' && renderDiversificationChart()}
              </div>
              
              <div className="text-center mt-2 text-sm text-gray-500">
                {activeChart === 'allocation' ? 'Portfolio Allocation' :
                activeChart === 'performance' ? 'Portfolio Performance' :
                activeChart === 'volatility' ? 'Portfolio Volatility' :
                'Diversification Benefit'}
              </div>
            </div>
            
            <div className="border-t pt-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-semibold">Portfolio Metrics</h3>
                {isCalculating && (
                  <span className="text-sm text-gray-500">Calculating...</span>
                )}
              </div>
              <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Weighted Average CVI:</span>
                  <span className="font-bold text-lg">
                    {Math.abs(totalAllocation - 100) < 0.01 ? calculateWeightedCVI().toFixed(1) : '-'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Portfolio CVI:</span>
                  <span className="font-bold text-lg">
                    {Math.abs(totalAllocation - 100) < 0.01 && portfolioCVI ? portfolioCVI.toFixed(1) : '-'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Benefit of Diversification:</span>
                  <span className="font-bold text-lg">
                    {Math.abs(totalAllocation - 100) < 0.01 && portfolioCVI && calculateWeightedCVI() 
                      ? `${((1 - (portfolioCVI / calculateWeightedCVI())) * 100).toFixed(1)}%`
                      : '-'}
                  </span>
                </div>
              </div>

              <div className="mt-4">
                <button
                  onClick={exportPortfolioData}
                  disabled={!portfolioPrices || !rollingCVIs || Math.abs(totalAllocation - 100) >= 0.01}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  <Download className="w-4 h-4" />
                  Export Portfolio Data
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center text-gray-500 py-4">
            Add securities to see portfolio analysis
          </div>
        )}
      </div>

      {/* Security Selector */}
      <div className="lg:col-span-2 bg-white rounded-lg shadow p-4">
        <h2 className="text-xl font-bold mb-4">Add Securities</h2>
        <div className="mb-4">
          <div className="flex items-center bg-gray-100 rounded-md px-3">
            <Search className="w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search for stocks or ETFs..."
              className="flex-1 bg-transparent border-none focus:outline-none px-3 py-2"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          {searchTerm && (
            <div className="text-sm text-gray-500 mt-2">
              Showing first 10 matches. Keep typing to refine results.
            </div>
          )}
        </div>
        
        {filteredSecurities.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSecurities.map((security) => (
              <div
                key={security.Symbol}
                className="p-3 bg-gray-50 rounded"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-medium">{security.Symbol}</div>
                    <div className="text-sm text-gray-500">{security.Name}</div>
                    <div className="flex items-center gap-4 mt-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">SecState:</span>
                        <span className="font-medium">{security.SecState}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">Thermo:</span>
                        {getThermoBox(security.Thermostat)}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">CVI:</span>
                        <span className="font-medium">{formatCVI(security.CVI)}</span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => addToPortfolio(security)}
                    disabled={portfolio.some(h => h.Symbol === security.Symbol)}
                    className="p-1 text-blue-500 hover:text-blue-700 disabled:text-gray-400"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
  
};

export default PortfolioManager;